"""deployment/publish.py with fake gh/aws runners and a fake HTTPS fetch (no network, no AWS)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import publish as p  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SITE = json.loads((ROOT / "deployment" / "site.json").read_text())
ACTIVATION = json.loads((ROOT / "deployment" / "activation.json").read_text())
SHA = "c" * 40
ROLE = "arn:aws:sts::511831442607:assumed-role/wisestay-web-composer-publisher/composer-publish-9"
INDEX = b"<!doctype html><title>Composer</title>"


class Fake:
    def __init__(self):
        self.calls = []
        self.main = [SHA]
        self.identity = {"Account": "511831442607", "Arn": ROLE}
        self.parameter = {"repository": SITE["repository"], "origin": SITE["origin"], "bucket": SITE["bucket"],
                          "distribution_id": "E1ABCDEF234567", "account": "511831442607", "region": "ap-southeast-1"}
        self.aliases = ["composer.wizestay.com"]
        self.origin_domain = "wisestay-web-composer-511831442607.s3.ap-southeast-1.amazonaws.com"
        self.fail = {}

    def __call__(self, args, timeout):
        self.calls.append(list(args))
        if args[0] == "gh":
            value = self.main[0] if len(self.main) == 1 else self.main.pop(0)
            return self.ok(value + "\n")
        op = " ".join(args[1:3])
        if op in self.fail:
            return subprocess.CompletedProcess(args, 1, "", self.fail[op])
        if op == "sts get-caller-identity":
            return self.ok(json.dumps(self.identity))
        if op == "ssm get-parameter":
            return self.ok(json.dumps({"Parameter": {"Value": json.dumps(self.parameter)}}))
        if op == "cloudfront get-distribution":
            return self.ok(json.dumps({"Distribution": {"DistributionConfig": {
                "Aliases": {"Items": self.aliases},
                "Origins": {"Items": [{"DomainName": self.origin_domain}]}}}}))
        if op == "cloudfront create-invalidation":
            return self.ok(json.dumps({"Invalidation": {"Id": "I123"}}))
        return self.ok("")

    @staticmethod
    def ok(stdout):
        return subprocess.CompletedProcess([], 0, stdout, "")

    def uploads(self):
        return [c for c in self.calls if c[:2] == ["aws", "s3"]]


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dist = Path(self.tmp.name) / "dist"
        (self.dist / "src").mkdir(parents=True)
        (self.dist / "index.html").write_bytes(INDEX)
        (self.dist / "src" / "app.js").write_text("export {};\n")
        files = {path.relative_to(self.dist).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                 for path in self.dist.rglob("*") if path.is_file()}
        self.release = {"repository": SITE["repository"], "origin": SITE["origin"], "revision": SHA, "files": files}
        (self.dist / "release.json").write_text(json.dumps(self.release))
        self.fake = Fake()
        self.sleeps = []
        self.live = {
            "/release.json": (200, "application/json", json.dumps({"revision": SHA}).encode()),
            "/": (200, "text/html; charset=utf-8", INDEX),
            SITE["readiness_path"]: (200, "application/json", b'{"contract":"wisestay.web-session.v1","ready":true}'),
            "/assets/missing.js": (404, "text/html", b""),
        }
        self.env = {"GITHUB_REPOSITORY": SITE["repository"], "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": SHA,
                    "GITHUB_RUN_ID": "9", "GITHUB_RUN_ATTEMPT": "1"}

    def tearDown(self):
        self.tmp.cleanup()

    def fetch(self, url):
        self.assertTrue(url.startswith(SITE["origin"]), url)
        return self.live[url[len(SITE["origin"]):]]

    def run_publish(self, activation=None):
        ctx = p.Context(site=dict(SITE), activation=activation or dict(ACTIVATION), env=self.env, runner=self.fake,
                        fetch=self.fetch, sleep=self.sleeps.append, dist=self.dist)
        return p.publish(ctx)

    def assertStopped(self, receipt, result, label):
        self.assertEqual(receipt["result"], result, receipt)
        self.assertEqual(receipt["failure"]["label"], label, receipt)

    def test_committed_config_matches_the_contract(self):
        p.check_activation(ACTIVATION)
        self.assertEqual(SITE["publisher_role_arn"], "arn:aws:iam::511831442607:role/wisestay-web-composer-publisher")
        self.assertEqual(SITE["publication_parameter"], "/wisestay/dev/websites/composer/publication")
        self.assertEqual(SITE["bucket"], "wisestay-web-composer-511831442607")

    def test_activation_disabled_is_held_without_commands(self):
        receipt = self.run_publish(activation={**ACTIVATION, "enabled": False})
        self.assertStopped(receipt, "held", "ACTIVATION_DISABLED")
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(p.exit_code(receipt), 0)

    def test_wrong_role_or_account_is_refused_before_any_read(self):
        self.fake.identity = {"Account": "511831442607",
                              "Arn": "arn:aws:sts::511831442607:assumed-role/wisestay-web-finder-publisher/x"}
        self.assertStopped(self.run_publish(), "failed", "WRONG_ROLE")
        self.fake.identity = {"Account": "443217925086", "Arn": ROLE}
        receipt = self.run_publish()
        self.assertStopped(receipt, "failed", "WRONG_ACCOUNT")
        self.assertFalse(any(c[1] in ("ssm", "s3", "cloudfront") for c in self.fake.calls if c[0] == "aws"))
        self.assertEqual(p.exit_code(receipt), 1)

    def test_superseded_main_is_refused(self):
        self.fake.main = ["d" * 40]
        self.assertStopped(self.run_publish(), "failed", "SUPERSEDED_MAIN")
        self.fake.main = [SHA, "d" * 40]
        self.fake.calls.clear()
        self.assertStopped(self.run_publish(), "failed", "SUPERSEDED_MAIN")
        self.assertTrue(self.fake.uploads())
        self.assertFalse(any(c[2] == "cp" and c[3].endswith("index.html") for c in self.fake.uploads()))

    def test_hash_mismatch_is_refused_before_upload(self):
        (self.dist / "src" / "app.js").write_text("export const changed = 1;\n")
        self.assertStopped(self.run_publish(), "failed", "RELEASE_HASH_MISMATCH")
        self.assertEqual(self.fake.uploads(), [])

    def test_release_for_another_revision_is_refused(self):
        self.release["revision"] = "e" * 40
        (self.dist / "release.json").write_text(json.dumps(self.release))
        self.assertStopped(self.run_publish(), "failed", "RELEASE_REVISION_MISMATCH")

    def test_foreign_distribution_or_parameter_is_refused(self):
        self.fake.aliases = ["finder.wizestay.com"]
        self.assertStopped(self.run_publish(), "failed", "DISTRIBUTION_ALIAS_MISMATCH")
        self.fake.aliases = ["composer.wizestay.com"]
        self.fake.origin_domain = "other.s3.ap-southeast-1.amazonaws.com"
        self.assertStopped(self.run_publish(), "failed", "DISTRIBUTION_ORIGIN_MISMATCH")
        self.fake.parameter["bucket"] = "wisestay-web-finder-511831442607"
        self.assertStopped(self.run_publish(), "failed", "PUBLICATION_MISMATCH")
        self.assertEqual(self.fake.uploads(), [])

    def test_spa_html_on_the_readiness_route_fails(self):
        self.live[SITE["readiness_path"]] = (200, "text/html", INDEX)
        receipt = self.run_publish()
        self.assertStopped(receipt, "failed", "READINESS_NOT_SESSION_JSON")
        self.assertEqual(receipt["smoke"]["result"], "passed")
        self.assertEqual(receipt["readiness"]["result"], "failed")

    def test_missing_asset_served_as_page_fails(self):
        self.live["/assets/missing.js"] = (200, "text/html", INDEX)
        self.assertStopped(self.run_publish(), "failed", "MISSING_ASSET_SERVED")

    def test_live_revision_never_matching_fails_after_retries(self):
        self.live["/release.json"] = (200, "application/json", json.dumps({"revision": "f" * 40}).encode())
        receipt = self.run_publish()
        self.assertStopped(receipt, "failed", "LIVE_REVISION_MISMATCH")
        self.assertEqual(len(self.sleeps), p.LIVE_ATTEMPTS - 1)

    def test_happy_path_uploads_without_delete_and_writes_receipt(self):
        receipt = self.run_publish()
        self.assertEqual(receipt["result"], "deployed", receipt)
        self.assertEqual(p.exit_code(receipt), 0)
        self.assertEqual(receipt["contract"], "wisestay.3d.deployment-receipt.v1")
        self.assertEqual(receipt["caller_arn"], ROLE)
        self.assertEqual(receipt["distribution_id"], "E1ABCDEF234567")
        self.assertEqual(receipt["file_count"], 2)
        self.assertEqual(receipt["smoke"], {"url": "https://composer.wizestay.com/", "status": 200,
                                            "content_type": "text/html", "result": "passed"})
        self.assertEqual(receipt["readiness"]["result"], "passed")
        self.assertEqual(receipt["missing_asset"], {"status": 404, "result": "passed"})
        uploads = self.fake.uploads()
        self.assertFalse(any("--delete" in c or c[2] == "rm" for c in uploads))
        modules = next(c for c in uploads if "--include" in c)
        self.assertIn("text/javascript; charset=utf-8", modules)
        last_two = [c[3].rsplit("/", 1)[-1] for c in uploads[-2:]]
        self.assertEqual(last_two, ["index.html", "release.json"])
        self.assertTrue(all("no-store" in c for c in uploads[-2:]))
        ops = [" ".join(c[1:3]) for c in self.fake.calls if c[0] == "aws"]
        self.assertLess(ops.index("cloudfront create-invalidation"), ops.index("cloudfront wait"))

    def test_access_denied_reports_actions_not_provider_text(self):
        self.fake.fail["s3 sync"] = ("upload failed: An error occurred (AccessDenied) when calling the PutObject "
                                     "operation: User x is not authorized to perform: s3:PutObject on private-key")
        receipt = self.run_publish()
        self.assertStopped(receipt, "failed", "S3_ACCESS_DENIED")
        self.assertEqual(receipt["failure"]["aws_denied_actions"], ["s3:PutObject"])
        self.assertNotIn("private-key", json.dumps(receipt))


if __name__ == "__main__":
    unittest.main()
