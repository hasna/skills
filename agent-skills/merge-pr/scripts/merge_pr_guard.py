#!/usr/bin/env python3
"""Fail-closed merge command builder and provider-message postverify."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ACTUAL_MODES = {"immediate-merge", "auto-merge", "merge-queue"}
RISK_TIERS = {"routine": (1, 1), "elevated": (2, 2)}
REPO_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
SHA_PATTERN = re.compile(r"^[0-9a-fA-F]{40}$")
FORBIDDEN_TRAILER = re.compile(
    r"^[^\S\r\n]*co[^\S\r\n]*(?:-[^\S\r\n]*|[^\S\r\n]+)"
    r"authored[^\S\r\n]*(?:-[^\S\r\n]*|[^\S\r\n]+)by[^\S\r\n]*:",
    re.IGNORECASE | re.MULTILINE,
)


class GuardError(ValueError):
    """A fail-closed contract violation."""


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_object(path: str) -> dict[str, Any]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise GuardError(f"{path}: expected a JSON object")
    return value


def normalize_line_endings(value: str) -> str:
    if "\x00" in value:
        raise GuardError("message input contains a NUL byte")
    return value.replace("\r\n", "\n").replace("\r", "\n")


def forbidden_trailer_lines(message: str) -> list[int]:
    normalized = normalize_line_endings(message)
    return [
        index
        for index, line in enumerate(normalized.split("\n"), start=1)
        if FORBIDDEN_TRAILER.search(line)
    ]


def validate_message(subject: str, body: str) -> tuple[str, str]:
    normalized_subject = normalize_line_endings(subject).strip()
    normalized_body = normalize_line_endings(body)
    if not normalized_subject:
        raise GuardError("squash subject must not be blank")
    if "\n" in normalized_subject:
        raise GuardError("squash subject must be one line")
    if forbidden_trailer_lines(normalized_subject):
        raise GuardError("squash subject contains a forbidden Co-Authored-By trailer")
    if forbidden_trailer_lines(normalized_body):
        raise GuardError("squash body contains a forbidden Co-Authored-By trailer")
    return normalized_subject, normalized_body


def normalize_identity(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().casefold()
    return normalized or None


def parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def validate_target(repo: Any, pr_number: Any, head_sha: Any) -> tuple[str, int, str]:
    if not isinstance(repo, str) or not REPO_PATTERN.fullmatch(repo):
        raise GuardError("preflight repository must be OWNER/REPO")
    if not isinstance(pr_number, int) or isinstance(pr_number, bool) or pr_number < 1:
        raise GuardError("preflight PR number must be a positive integer")
    if not isinstance(head_sha, str) or not SHA_PATTERN.fullmatch(head_sha):
        raise GuardError("preflight head SHA must be 40 hexadecimal characters")
    return repo, pr_number, head_sha.lower()


def validate_artifacts(snapshot: dict[str, Any], risk_tier: str) -> None:
    required, _ = RISK_TIERS[risk_tier]
    artifacts = snapshot.get("reviewer_artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != required:
        raise GuardError(f"{risk_tier} preflight requires exactly {required} reviewer artifact(s)")
    if snapshot.get("required_reviewer_artifacts") != required:
        raise GuardError("preflight reviewer artifact count does not match the risk tier")

    repo, pr_number, head_sha = validate_target(
        snapshot.get("repo"), snapshot.get("pr_number"), snapshot.get("head_sha")
    )
    scope = snapshot.get("acceptance_scope")
    if not isinstance(scope, str) or not scope.strip():
        raise GuardError("preflight acceptance_scope must be nonblank")
    executor = normalize_identity(snapshot.get("executor_identity"))
    worker = normalize_identity(snapshot.get("worker_identity"))
    if not executor:
        raise GuardError("preflight executor_identity must be nonblank")
    if worker and worker == executor:
        raise GuardError("worker and executor identities must be distinct")

    reviewers: set[str] = set()
    for index, artifact in enumerate(artifacts, start=1):
        if not isinstance(artifact, dict):
            raise GuardError(f"reviewer artifact {index} must be an object")
        if artifact.get("repository") != repo or artifact.get("pr_number") != pr_number:
            raise GuardError(f"reviewer artifact {index} target mismatch")
        artifact_head = artifact.get("head_sha")
        if not isinstance(artifact_head, str) or artifact_head.lower() != head_sha:
            raise GuardError(f"reviewer artifact {index} head mismatch")
        if artifact.get("acceptance_scope") != scope:
            raise GuardError(f"reviewer artifact {index} acceptance scope mismatch")
        reviewer_identity = normalize_identity(artifact.get("reviewer_identity"))
        reviewer_run_id = normalize_identity(artifact.get("reviewer_run_id"))
        reviewer_tokens = {token for token in (reviewer_identity, reviewer_run_id) if token}
        if not reviewer_tokens:
            raise GuardError(f"reviewer artifact {index} has no reviewer identity")
        if reviewers.intersection(reviewer_tokens):
            raise GuardError("reviewer artifacts are not independent")
        if {executor, worker}.intersection(reviewer_tokens):
            raise GuardError(f"reviewer artifact {index} conflicts with worker or executor")
        reviewers.update(reviewer_tokens)
        timestamp = parse_timestamp(artifact.get("timestamp"))
        if timestamp is None:
            raise GuardError(f"reviewer artifact {index} has an invalid timestamp")
        age = (datetime.now(timezone.utc) - timestamp).total_seconds()
        if age < -60:
            raise GuardError(f"reviewer artifact {index} is from the future")
        if age > 24 * 60 * 60:
            raise GuardError(f"reviewer artifact {index} is stale")
        if str(artifact.get("verdict", "")).strip().casefold() not in {"approved", "pass", "passed"}:
            raise GuardError(f"reviewer artifact {index} is not approved")
        checked = artifact.get("checked_risks_summary")
        if not isinstance(checked, str) or not checked.strip():
            raise GuardError(f"reviewer artifact {index} lacks checked risks")
        if artifact.get("blocking_findings") != []:
            raise GuardError(f"reviewer artifact {index} has blocking findings")


def validate_preflight(
    snapshot: dict[str, Any], max_age_seconds: int, delayed_intent: bool
) -> tuple[str, int, str]:
    mode = snapshot.get("mode")
    if mode not in ACTUAL_MODES:
        raise GuardError("preflight mode is not an actual merge mode")
    verdict = snapshot.get("verdict")
    allowed_verdicts = {"mergeable"}
    if mode in {"auto-merge", "merge-queue"} and delayed_intent:
        allowed_verdicts.add("pending")
    if verdict not in allowed_verdicts:
        raise GuardError("preflight verdict does not authorize this merge mode")
    if snapshot.get("blocking_reasons") != []:
        raise GuardError("preflight has blocking reasons")

    risk = snapshot.get("risk_tier")
    risk_tier = risk.get("effective") if isinstance(risk, dict) else None
    if (
        risk_tier not in RISK_TIERS
        or not isinstance(risk, dict)
        or risk.get("source") != "explicit"
        or risk.get("declared") != risk_tier
    ):
        raise GuardError("preflight risk tier must be explicit routine or elevated")

    cycles = snapshot.get("repair_cycles")
    _, expected_cap = RISK_TIERS[risk_tier]
    if not isinstance(cycles, dict):
        raise GuardError("preflight repair cycle evidence is missing")
    count = cycles.get("count")
    if not isinstance(count, int) or isinstance(count, bool) or count < 0 or count > expected_cap:
        raise GuardError("preflight repair cycle count exceeds the tier cap")
    if cycles.get("cap") != expected_cap:
        raise GuardError("preflight repair cycle cap does not match the tier")

    observed_at = parse_timestamp(snapshot.get("observed_at"))
    if observed_at is None:
        raise GuardError("preflight observed_at is invalid")
    age = (datetime.now(timezone.utc) - observed_at).total_seconds()
    if age < -60 or age > max_age_seconds:
        raise GuardError("preflight is stale or from the future")

    merge_state = snapshot.get("merge_state")
    if not isinstance(merge_state, dict):
        raise GuardError("preflight merge state evidence is missing")
    if merge_state.get("state") != "OPEN":
        raise GuardError("preflight PR state is not open")
    if merge_state.get("is_draft") is not False:
        raise GuardError("preflight PR is draft or draft state is invalid")
    if merge_state.get("mergeable") != "MERGEABLE":
        raise GuardError("preflight PR is not mergeable")
    merge_status = merge_state.get("merge_state_status")
    if verdict == "mergeable" and merge_status != "CLEAN":
        raise GuardError("preflight merge state is not clean")
    if verdict == "pending" and merge_status not in {"BEHIND", "HAS_HOOKS", "UNSTABLE"}:
        raise GuardError("pending preflight merge state is not queue-compatible")
    if str(merge_state.get("review_decision", "")).upper() in {"CHANGES_REQUESTED", "REVIEW_REQUIRED"}:
        raise GuardError("preflight review decision blocks merge")

    checks = snapshot.get("checks")
    if not isinstance(checks, list):
        raise GuardError("preflight checks evidence is missing")
    saw_pending = False
    for check in checks:
        if not isinstance(check, dict):
            raise GuardError("preflight check entry is invalid")
        states = {
            str(value).strip().casefold()
            for value in (check.get("bucket"), check.get("state"), check.get("conclusion"))
            if value is not None
        }
        if states.intersection(
            {
                "action_required",
                "cancel",
                "cancelled",
                "error",
                "fail",
                "failed",
                "failure",
                "neutral",
                "skipped",
                "stale",
                "timed_out",
            }
        ):
            raise GuardError("preflight contains a failed or non-successful check")
        if states.intersection({"expected", "in_progress", "pending", "queued", "requested", "waiting"}):
            saw_pending = True
            continue
        if states and not states.intersection({"pass", "passed", "success", "successful"}):
            raise GuardError("preflight contains an unknown check state")
    if verdict == "pending" and not saw_pending:
        raise GuardError("pending preflight has no pending check evidence")
    if verdict == "mergeable" and saw_pending:
        raise GuardError("mergeable preflight still has pending checks")

    validate_artifacts(snapshot, risk_tier)
    return validate_target(snapshot.get("repo"), snapshot.get("pr_number"), snapshot.get("head_sha"))


def read_body(args: argparse.Namespace) -> str:
    if args.body is not None and args.body_file is not None:
        raise GuardError("use only one of --body and --body-file")
    if args.body_file is not None:
        return Path(args.body_file).read_text(encoding="utf-8")
    return args.body or ""


def build_command(args: argparse.Namespace) -> dict[str, Any]:
    snapshot = load_object(args.preflight)
    repo, pr_number, head_sha = validate_preflight(
        snapshot, args.max_preflight_age_seconds, args.delayed_intent
    )
    mode = snapshot["mode"]

    if mode == "auto-merge" and not args.delayed_intent:
        raise GuardError("auto-merge requires explicit --delayed-intent")
    if mode == "immediate-merge" and args.delayed_intent:
        raise GuardError("--delayed-intent is not valid for immediate merge")
    if mode == "merge-queue":
        if snapshot["verdict"] == "pending" and not args.delayed_intent:
            raise GuardError("pending merge queue requires explicit --delayed-intent")
        if snapshot["verdict"] == "mergeable" and args.delayed_intent:
            raise GuardError("--delayed-intent is only valid for a pending merge queue")

    argv = ["gh", "pr", "merge", str(pr_number), "--repo", repo]
    if mode == "merge-queue":
        if args.strategy is not None or args.subject is not None or args.body is not None or args.body_file is not None:
            raise GuardError("merge-queue does not accept strategy or message input")
    else:
        if args.strategy is None:
            raise GuardError("an explicit merge strategy is required")
        argv.append(f"--{args.strategy}")
        if args.strategy == "squash":
            if args.subject is None:
                raise GuardError("squash requires an explicit subject")
            subject, body = validate_message(args.subject, read_body(args))
            argv.extend(["--subject", subject, "--body", body])
        elif args.subject is not None or args.body is not None or args.body_file is not None:
            raise GuardError("explicit subject/body is supported only for squash")

    argv.extend(["--match-head-commit", head_sha])
    if mode == "auto-merge":
        argv.append("--auto")

    forbidden = {"--admin", "--force", "--delete-branch"}
    if forbidden.intersection(argv) or argv[:3] != ["gh", "pr", "merge"]:
        raise GuardError("constructed command violates the merge safety contract")
    return {
        "kind": "merge-pr-command",
        "outcome": "ready",
        "repo": repo,
        "pr_number": pr_number,
        "head_sha": head_sha,
        "acceptance_scope": snapshot["acceptance_scope"],
        "mode": mode,
        "argv": argv,
        "display": shlex.join(argv),
    }


def run_json(command: list[str]) -> dict[str, Any]:
    result = subprocess.run(command, check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise GuardError(f"provider query failed with exit {result.returncode}")
    value = json.loads(result.stdout)
    if not isinstance(value, dict):
        raise GuardError("provider query returned a non-object")
    return value


def provider_result(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    if args.fixture:
        fixture = load_object(args.fixture)
        pr_view = fixture.get("pr_view")
        commit = fixture.get("commit")
        if not isinstance(pr_view, dict) or not isinstance(commit, dict):
            raise GuardError("fixture requires pr_view and commit objects")
        return pr_view, commit

    fields = "state,mergedAt,mergeCommit,headRefOid,baseRefName,url"
    pr_view = run_json(["gh", "pr", "view", str(args.pr), "--repo", args.repo, "--json", fields])
    merge_commit = pr_view.get("mergeCommit")
    merge_sha = merge_commit.get("oid") if isinstance(merge_commit, dict) else None
    if not isinstance(merge_sha, str) or not SHA_PATTERN.fullmatch(merge_sha):
        raise GuardError("provider did not report a valid merge commit SHA")
    commit = run_json(["gh", "api", f"repos/{args.repo}/commits/{merge_sha}"])
    return pr_view, commit


def atomic_write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(f"{json.dumps(value, indent=2, sort_keys=True)}\n", encoding="utf-8")
    temporary.replace(path)


def postverify(args: argparse.Namespace) -> int:
    receipt_path = Path(args.receipt)
    receipt: dict[str, Any] = {
        "kind": "merge-pr-postverify",
        "outcome": "failed",
        "repo": args.repo,
        "pr_number": args.pr,
        "expected_head_sha": args.expected_head_sha.lower(),
        "observed_at": utc_now(),
        "failure_reasons": [],
    }
    try:
        validate_target(args.repo, args.pr, args.expected_head_sha)
        pr_view, commit = provider_result(args)
        provider_head = pr_view.get("headRefOid")
        merge_commit = pr_view.get("mergeCommit")
        merge_sha = merge_commit.get("oid") if isinstance(merge_commit, dict) else None
        commit_sha = commit.get("sha")
        commit_data = commit.get("commit")
        message = commit_data.get("message") if isinstance(commit_data, dict) else None

        receipt.update(
            {
                "provider_state": pr_view.get("state"),
                "provider_head_sha": provider_head,
                "merge_commit_sha": merge_sha,
            }
        )
        failures: list[str] = []
        if pr_view.get("state") != "MERGED":
            failures.append("provider_state_not_merged")
        if not isinstance(provider_head, str) or provider_head.lower() != args.expected_head_sha.lower():
            failures.append("provider_head_sha_mismatch")
        if not isinstance(merge_sha, str) or not SHA_PATTERN.fullmatch(merge_sha):
            failures.append("merge_commit_sha_invalid")
        if commit_sha != merge_sha:
            failures.append("commit_query_sha_mismatch")
        if not isinstance(message, str):
            failures.append("merge_commit_message_missing")
        else:
            lines = forbidden_trailer_lines(message)
            receipt["merge_commit_message_sha256"] = hashlib.sha256(message.encode("utf-8")).hexdigest()
            receipt["forbidden_trailer_line_numbers"] = lines
            if lines:
                failures.append("forbidden_co_authored_by_trailer")

        receipt["failure_reasons"] = failures
        receipt["outcome"] = "clean" if not failures else "failed"
    except (GuardError, OSError, json.JSONDecodeError) as error:
        receipt["failure_reasons"] = [str(error)]

    atomic_write(receipt_path, receipt)
    print(json.dumps(receipt, indent=2, sort_keys=True))
    return 0 if receipt["outcome"] == "clean" else 1


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    subparsers = root.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build", help="Build a guarded gh pr merge argv")
    build.add_argument("--preflight", required=True)
    build.add_argument("--strategy", choices=["squash", "merge", "rebase"])
    build.add_argument("--subject")
    build.add_argument("--body")
    build.add_argument("--body-file")
    build.add_argument("--delayed-intent", action="store_true")
    build.add_argument("--max-preflight-age-seconds", type=int, default=300)

    verify = subparsers.add_parser("postverify", help="Verify the actual provider merge commit message")
    verify.add_argument("--repo", required=True)
    verify.add_argument("--pr", required=True, type=int)
    verify.add_argument("--expected-head-sha", required=True)
    verify.add_argument("--receipt", required=True)
    verify.add_argument("--fixture")
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "build":
            print(json.dumps(build_command(args), indent=2, sort_keys=True))
            return 0
        return postverify(args)
    except (GuardError, OSError, json.JSONDecodeError) as error:
        print(json.dumps({"kind": "merge-pr-guard-error", "error": str(error)}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
