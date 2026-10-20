""".github/workflows/ci.yml publication-job gating, pins and OIDC scope (wave 3 plan §6.3.4)."""
from __future__ import annotations

from pathlib import Path
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
ROLE = "arn:aws:iam::511831442607:role/wisestay-web-composer-publisher"
PINS = {
    "actions/checkout": "11bd71901bbe5b1630ceea73d27597364c9af683",
    "aws-actions/configure-aws-credentials": "61815dcd50bd041e203e49132bacad1fd04d2708",
    "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
    "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/setup-python": "a26af69be951a213d495a4c3e4e4022e16d87065",
}


def load():
    text = WORKFLOW.read_text(encoding="utf-8")
    data = yaml.safe_load(text)
    data["on"] = data.pop(True, data.get("on"))  # YAML 1.1 reads the bare key "on" as True
    return text, data


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.text, self.data = load()
        self.jobs = self.data["jobs"]
        self.deploy = self.jobs["deploy"]

    def test_triggers_and_dispatch_input(self):
        on = self.data["on"]
        self.assertEqual(on["push"]["branches"], ["main"])
        self.assertIn("pull_request", on)
        deploy = on["workflow_dispatch"]["inputs"]["deploy"]
        self.assertEqual((deploy["type"], deploy["default"]), ("boolean", False))
        self.assertEqual(self.data["permissions"], {"contents": "read"})
        self.assertEqual(self.data["concurrency"]["cancel-in-progress"], "${{ github.event_name == 'pull_request' }}")

    def test_deploy_job_gating(self):
        self.assertEqual(self.deploy["needs"], ["application"])
        self.assertEqual(self.deploy["if"], (
            "github.repository == 'majidsamadi/home-composer-app' && github.ref == 'refs/heads/main' && "
            "(github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.deploy == true))"))
        self.assertEqual(self.deploy["permissions"], {"contents": "read", "id-token": "write"})
        self.assertEqual(self.deploy["concurrency"], {"group": "wisestay-web-composer-publication",
                                                      "cancel-in-progress": False})

    def test_only_deploy_job_can_request_an_oidc_token(self):
        for name, job in self.jobs.items():
            if name != "deploy":
                self.assertNotIn("id-token", job.get("permissions", {}) or {}, name)
        self.assertNotRegex(self.text, r"secrets\.AWS_|aws-access-key-id|aws-secret-access-key")

    def test_every_action_is_pinned(self):
        uses = [step["uses"] for job in self.jobs.values() for step in job["steps"] if "uses" in step]
        for item in uses:
            action, _, ref = item.partition("@")
            self.assertEqual(ref, PINS[action], item)

    def test_application_job_builds_and_runs_publication_tests(self):
        runs = [step.get("run", "") for step in self.jobs["application"]["steps"]]
        self.assertIn("npm test", runs)
        self.assertIn("node scripts/build-site.mjs", runs)
        self.assertIn("python -m unittest discover -s deployment -p 'test_*.py' -v", runs)

    def test_credentials_are_literal_and_checked_before_publication(self):
        steps = self.deploy["steps"]
        creds = next(s for s in steps if s.get("uses", "").startswith("aws-actions/configure-aws-credentials@"))
        self.assertEqual(creds["with"], {
            "role-to-assume": ROLE,
            "aws-region": "ap-southeast-1",
            "allowed-account-ids": "511831442607",
            "role-session-name": "composer-publish-${{ github.run_id }}",
            "role-duration-seconds": 3600,
            "unset-current-credentials": True,
        })
        names = [s.get("name", s.get("uses", "")) for s in steps]
        build = names.index("Build the static site for this commit")
        guard = names.index("Reject superseded main before AWS credentials")
        assume = names.index("Assume only the Composer site publisher role")
        verify = names.index("Verify caller identity before publication")
        publish = names.index("Publish, invalidate and verify the live site")
        self.assertTrue(build < guard < assume < verify < publish)
        self.assertIn("assumed-role/wisestay-web-composer-publisher/", steps[verify]["run"])
        self.assertEqual(steps[publish]["run"], "python3 deployment/publish.py")
        upload = next(s for s in steps if s.get("uses", "").startswith("actions/upload-artifact@"))
        self.assertEqual(upload["if"], "always()")
        self.assertEqual(upload["with"]["name"], "deployment-receipt-${{ github.sha }}")
        self.assertEqual(upload["with"]["path"], "dist/deployment-receipt.json")


if __name__ == "__main__":
    unittest.main()
