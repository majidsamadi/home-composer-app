"""Publish the verified Composer site build to its own dev hosting (wave 3 plan §6.3.3).

Run by the ``deploy`` job in ``.github/workflows/ci.yml`` only, after OIDC has
assumed ``wisestay-web-composer-publisher`` in account 511831442607. Stdlib plus
the runner's ``gh`` and ``aws`` CLIs (modelled on wisestay-ota-web publish.py).

Order: activation -> current main -> caller identity -> publication parameter ->
distribution alias and S3 origin -> release.json hashes -> asset sync (never
delete) -> current main again -> index.html and release.json (no-store) ->
invalidate /* and wait -> live revision and index hash -> web-session readiness
JSON -> missing asset 403/404 -> receipt. Provider output is never printed.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Callable
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ACCOUNT = "511831442607"
APPROVAL_REFERENCE = "owner-3d-dev-deployment-2026-10-20"
ACTIVATION_CONTRACT = "wisestay.3d.activation.v1"
RECEIPT_CONTRACT = "wisestay.3d.deployment-receipt.v1"
SCRIPT_TYPE = "text/javascript; charset=utf-8"
LIVE_ATTEMPTS = 12
LIVE_INTERVAL_S = 10
DENIED_SERVICES = ("s3", "cloudfront", "ssm", "sts", "kms")
_DENIED = re.compile(r"not authorized to perform:?\s+((?:%s):[A-Z][A-Za-z]+)" % "|".join(DENIED_SERVICES))

Runner = Callable[[list, int], "subprocess.CompletedProcess[str]"]
# fetch(url) -> (status | None, content type, body bytes)
Fetch = Callable[[str], "tuple[int | None, str, bytes]"]


class Stop(Exception):
    def __init__(self, result: str, label: str, operation: str = "", denied: list | None = None) -> None:
        super().__init__(label)
        self.result = result
        self.label = label
        self.operation = operation
        self.denied = denied or []


def held(condition: bool, label: str) -> None:
    if not condition:
        raise Stop("held", label)


def refuse(condition: bool, label: str) -> None:
    if not condition:
        raise Stop("failed", label)


def default_runner(args: list, timeout: int) -> "subprocess.CompletedProcess[str]":
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False,
                          env={**os.environ, "AWS_PAGER": ""})


def default_fetch(url: str) -> "tuple[int | None, str, bytes]":
    request = urllib.request.Request(url, method="GET", headers={"Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.headers.get("Content-Type", ""), response.read(2_000_000)
    except urllib.error.HTTPError as error:
        return error.code, (error.headers.get("Content-Type", "") if error.headers else ""), b""
    except (urllib.error.URLError, OSError, ValueError):
        return None, "", b""


@dataclass
class Context:
    site: dict
    activation: dict
    env: dict
    runner: Runner
    fetch: Fetch
    sleep: Callable[[float], None]
    dist: Path


def command(ctx: Context, operation: str, args: list, timeout: int = 300) -> str:
    try:
        result = ctx.runner(args, timeout)
    except subprocess.TimeoutExpired:
        raise Stop("failed", operation.upper() + "_TIMEOUT", operation) from None
    except OSError:
        raise Stop("failed", operation.upper() + "_UNAVAILABLE", operation) from None
    if result.returncode != 0:
        text = (result.stderr or "") + "\n" + (result.stdout or "")
        denied = sorted(set(_DENIED.findall(text)))[:4]
        label = operation.upper() + ("_ACCESS_DENIED" if denied or "AccessDenied" in text else "_FAILED")
        raise Stop("failed", label, operation, denied)
    return result.stdout


def parse(text: str, label: str) -> dict:
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        raise Stop("failed", label) from None
    refuse(isinstance(value, dict), label)
    return value


def check_activation(activation: dict) -> None:
    held(activation.get("contract") == ACTIVATION_CONTRACT and activation.get("enabled") is True
         and activation.get("environment") == "dev" and activation.get("account") == ACCOUNT
         and activation.get("approval_reference") == APPROVAL_REFERENCE, "ACTIVATION_DISABLED")


def current_main(ctx: Context) -> str:
    return command(ctx, "gh", ["gh", "api", f"repos/{ctx.site['repository']}/git/ref/heads/main",
                               "--jq", ".object.sha"], 60).strip()


def check_source(ctx: Context) -> str:
    env = ctx.env
    refuse(env.get("GITHUB_REPOSITORY") == ctx.site["repository"] and env.get("GITHUB_REF") == "refs/heads/main",
           "MAIN_ONLY")
    revision = env.get("GITHUB_SHA", "")
    refuse(re.fullmatch(r"[0-9a-f]{40}", revision) is not None, "SOURCE_REQUIRED")
    refuse(current_main(ctx) == revision, "SUPERSEDED_MAIN")
    return revision


def check_caller(ctx: Context) -> str:
    identity = parse(command(ctx, "sts", ["aws", "sts", "get-caller-identity", "--output", "json"], 60),
                     "CALLER_IDENTITY_UNREADABLE")
    refuse(identity.get("Account") == ACCOUNT == ctx.site["account"], "WRONG_ACCOUNT")
    arn = str(identity.get("Arn", ""))
    prefix = ctx.site["assumed_role_prefix"]
    refuse(arn.startswith(prefix) and len(arn) > len(prefix), "WRONG_ROLE")
    return arn


def publication(ctx: Context) -> dict:
    site = ctx.site
    raw = parse(command(ctx, "ssm", ["aws", "ssm", "get-parameter", "--name", site["publication_parameter"],
                                     "--region", site["region"], "--output", "json"], 60), "PUBLICATION_UNREADABLE")
    try:
        value = json.loads(raw["Parameter"]["Value"])
    except (KeyError, TypeError, json.JSONDecodeError):
        raise Stop("failed", "PUBLICATION_UNREADABLE", "ssm") from None
    refuse(isinstance(value, dict) and value.get("repository") == site["repository"]
           and value.get("origin") == site["origin"] and value.get("bucket") == site["bucket"]
           and value.get("account") == ACCOUNT and value.get("region") == site["region"]
           and re.fullmatch(r"E[A-Z0-9]{6,20}", str(value.get("distribution_id", ""))) is not None,
           "PUBLICATION_MISMATCH")
    return value


def check_distribution(ctx: Context, distribution_id: str) -> None:
    site = ctx.site
    found = parse(command(ctx, "cloudfront", ["aws", "cloudfront", "get-distribution", "--id", distribution_id,
                                              "--output", "json"], 60), "DISTRIBUTION_UNREADABLE")
    try:
        config = found["Distribution"]["DistributionConfig"]
        aliases = config["Aliases"].get("Items") or []
        origins = config["Origins"].get("Items") or []
    except (KeyError, TypeError, AttributeError):
        raise Stop("failed", "DISTRIBUTION_UNREADABLE", "cloudfront") from None
    host = site["origin"].removeprefix("https://")
    refuse(aliases == [host], "DISTRIBUTION_ALIAS_MISMATCH")
    expected = f"{site['bucket']}.s3.{site['region']}.amazonaws.com"
    refuse(any(item.get("DomainName") == expected for item in origins), "DISTRIBUTION_ORIGIN_MISMATCH")


def verify_release(ctx: Context, revision: str) -> dict:
    path = ctx.dist / "release.json"
    refuse(path.is_file(), "RELEASE_MISSING")
    release = parse(path.read_text(encoding="utf-8"), "RELEASE_UNREADABLE")
    refuse(release.get("revision") == revision, "RELEASE_REVISION_MISMATCH")
    refuse(release.get("repository") == ctx.site["repository"] and release.get("origin") == ctx.site["origin"],
           "RELEASE_SITE_MISMATCH")
    actual = {}
    for item in sorted(ctx.dist.rglob("*")):
        refuse(not item.is_symlink(), "RELEASE_SYMLINK")
        if item.is_file() and item != path:
            actual[item.relative_to(ctx.dist).as_posix()] = hashlib.sha256(item.read_bytes()).hexdigest()
    refuse(actual == release.get("files"), "RELEASE_HASH_MISMATCH")
    refuse("index.html" in actual, "RELEASE_INDEX_MISSING")
    return release


def upload(ctx: Context, revision: str) -> None:
    destination = f"s3://{ctx.site['bucket']}"
    dist = str(ctx.dist)
    # Old assets stay available for open tabs and rollback: never --delete.
    command(ctx, "s3", ["aws", "s3", "sync", dist, destination, "--exclude", "index.html", "--exclude", "release.json",
                        "--exclude", "*.js", "--exclude", "*.mjs", "--cache-control", "public,max-age=300",
                        "--only-show-errors"], 900)
    # ES modules must be served with a JavaScript MIME type.
    command(ctx, "s3", ["aws", "s3", "cp", dist, destination, "--recursive", "--exclude", "*", "--include", "*.js",
                        "--include", "*.mjs", "--content-type", SCRIPT_TYPE, "--cache-control", "public,max-age=300",
                        "--only-show-errors"], 900)
    refuse(current_main(ctx) == revision, "SUPERSEDED_MAIN")
    for name, content_type in (("index.html", "text/html; charset=utf-8"), ("release.json", "application/json")):
        command(ctx, "s3", ["aws", "s3", "cp", str(ctx.dist / name), f"{destination}/{name}", "--cache-control",
                            "no-store", "--content-type", content_type, "--only-show-errors"], 300)


def invalidate(ctx: Context, distribution_id: str) -> None:
    created = parse(command(ctx, "cloudfront", ["aws", "cloudfront", "create-invalidation", "--distribution-id",
                                                distribution_id, "--paths", "/*", "--output", "json"], 120),
                    "INVALIDATION_UNREADABLE")
    try:
        invalidation = created["Invalidation"]["Id"]
    except (KeyError, TypeError):
        raise Stop("failed", "INVALIDATION_UNREADABLE", "cloudfront") from None
    command(ctx, "cloudfront", ["aws", "cloudfront", "wait", "invalidation-completed", "--distribution-id",
                                distribution_id, "--id", invalidation], 1200)


def verify_live(ctx: Context, release: dict, receipt: dict) -> None:
    origin = ctx.site["origin"]
    smoke = {"url": origin + "/", "status": None, "content_type": "", "result": "pending"}
    receipt["smoke"] = smoke
    for attempt in range(LIVE_ATTEMPTS):
        status, _, body = ctx.fetch(origin + "/release.json")
        live_revision = None
        if status == 200:
            try:
                live_revision = json.loads(body.decode("utf-8")).get("revision")
            except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                live_revision = None
        index_status, index_type, index_body = ctx.fetch(origin + "/")
        smoke["status"], smoke["content_type"] = index_status, index_type.split(";")[0].strip()
        if (live_revision == release["revision"] and index_status == 200 and smoke["content_type"] == "text/html"
                and hashlib.sha256(index_body).hexdigest() == release["files"]["index.html"]):
            smoke["result"] = "passed"
            break
        if attempt == LIVE_ATTEMPTS - 1:
            smoke["result"] = "failed"
            raise Stop("failed", "LIVE_REVISION_MISMATCH", "smoke")
        ctx.sleep(LIVE_INTERVAL_S)
    status, content_type, body = ctx.fetch(origin + ctx.site["readiness_path"])
    readiness = {"status": status, "content_type": content_type.split(";")[0].strip(), "result": "failed"}
    receipt["readiness"] = readiness
    try:
        parsed = json.loads(body.decode("utf-8")) if body else None
    except (UnicodeDecodeError, json.JSONDecodeError):
        parsed = None
    refuse(status == 200 and readiness["content_type"] == "application/json" and isinstance(parsed, dict),
           "READINESS_NOT_SESSION_JSON")
    readiness["result"] = "passed"
    status, _, _ = ctx.fetch(origin + "/assets/missing.js")
    receipt["missing_asset"] = {"status": status, "result": "passed" if status in (403, 404) else "failed"}
    refuse(status in (403, 404), "MISSING_ASSET_SERVED")


def new_receipt(ctx: Context) -> dict:
    env = ctx.env
    return {
        "contract": RECEIPT_CONTRACT,
        "repository": ctx.site["repository"],
        "revision": env.get("GITHUB_SHA", ""),
        "run_id": env.get("GITHUB_RUN_ID", ""),
        "run_attempt": env.get("GITHUB_RUN_ATTEMPT", ""),
        "caller_arn": None,
        "account": None,
        "state_key": None,
        "plan_summary": None,
        "files_sha256": None,
        "file_count": None,
        "distribution_id": None,
        "smoke": None,
        "readiness": None,
        "missing_asset": None,
        "result": "failed",
        "failure": None,
    }


def publish(ctx: Context) -> dict:
    receipt = new_receipt(ctx)
    try:
        check_activation(ctx.activation)
        revision = check_source(ctx)
        receipt["caller_arn"] = check_caller(ctx)
        receipt["account"] = ACCOUNT
        target = publication(ctx)
        receipt["distribution_id"] = target["distribution_id"]
        check_distribution(ctx, target["distribution_id"])
        release = verify_release(ctx, revision)
        receipt["files_sha256"] = hashlib.sha256(
            json.dumps(release["files"], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        receipt["file_count"] = len(release["files"])
        upload(ctx, revision)
        invalidate(ctx, target["distribution_id"])
        verify_live(ctx, release, receipt)
        receipt["result"] = "deployed"
    except Stop as stop:
        receipt["result"] = stop.result
        receipt["failure"] = {"label": stop.label, "operation": stop.operation, "aws_denied_actions": stop.denied}
    except Exception as error:  # noqa: BLE001 - never publish provider text or a traceback
        receipt["result"] = "failed"
        receipt["failure"] = {"label": "UNEXPECTED_" + type(error).__name__.upper(), "operation": "",
                              "aws_denied_actions": []}
    return receipt


def exit_code(receipt: dict) -> int:
    if receipt["result"] == "deployed":
        return 0
    if receipt["result"] == "held" and (receipt.get("failure") or {}).get("label") == "ACTIVATION_DISABLED":
        return 0
    return 1


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--receipt", type=Path, default=ROOT / "dist" / "deployment-receipt.json")
    args = parser.parse_args(argv)
    site = json.loads((ROOT / "deployment" / "site.json").read_text(encoding="utf-8"))
    ctx = Context(site=site, activation=json.loads((ROOT / "deployment" / "activation.json").read_text(encoding="utf-8")),
                  env=dict(os.environ), runner=default_runner, fetch=default_fetch, sleep=time.sleep,
                  dist=ROOT / site["output"])
    receipt = publish(ctx)
    # The receipt is written after verification so it is never part of the published files.
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"result": receipt["result"], "failure": receipt["failure"], "smoke": receipt["smoke"]}))
    return exit_code(receipt)


if __name__ == "__main__":
    sys.exit(main())
