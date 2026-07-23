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
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ACTUAL_MODES = {"immediate-merge", "auto-merge", "merge-queue"}
RISK_TIERS = {"routine": (1, 1), "elevated": (2, 2)}
MAX_PREFLIGHT_AGE_SECONDS = 300
REPO_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
SHA_PATTERN = re.compile(r"^[0-9a-fA-F]{40}$")
SHA256_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")
TASK_ID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-"
    r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)
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
    normalized = unicodedata.normalize("NFKC", value).strip().casefold()
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


def validate_pr_url(value: Any, repo: str, pr_number: int) -> str:
    if not isinstance(value, str):
        raise GuardError("preflight PR URL is missing")
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.netloc.casefold() != "github.com":
        raise GuardError("preflight PR URL must use https://github.com")
    if parsed.path.rstrip("/") != f"/{repo}/pull/{pr_number}" or parsed.query or parsed.fragment:
        raise GuardError("preflight PR URL does not match the target")
    return value


def validate_artifacts(snapshot: dict[str, Any], risk_tier: str) -> None:
    required, _ = RISK_TIERS[risk_tier]
    artifacts = snapshot.get("reviewer_artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != required:
        raise GuardError(f"{risk_tier} preflight requires exactly {required} reviewer artifact(s)")
    declared_required = snapshot.get("required_reviewer_artifacts")
    if (
        not isinstance(declared_required, int)
        or isinstance(declared_required, bool)
        or declared_required != required
    ):
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
    if not worker:
        raise GuardError("preflight worker_identity must be nonblank")
    if worker == executor:
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
    snapshot: dict[str, Any],
    delayed_intent: bool,
    expected_task_id: str,
    expected_acceptance_scope: str,
    expected_repair_cycle_count: int,
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
    if not TASK_ID_PATTERN.fullmatch(expected_task_id) or snapshot.get("task_id") != expected_task_id:
        raise GuardError("preflight task ID does not match the executor task")
    if (
        not expected_acceptance_scope.strip()
        or snapshot.get("acceptance_scope") != expected_acceptance_scope
    ):
        raise GuardError("preflight acceptance scope does not match the frozen scope")

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
    cycle_cap = cycles.get("cap")
    if (
        not isinstance(cycle_cap, int)
        or isinstance(cycle_cap, bool)
        or cycle_cap != expected_cap
    ):
        raise GuardError("preflight repair cycle cap does not match the tier")
    if count != expected_repair_cycle_count:
        raise GuardError("preflight repair cycle count does not match the executor count")

    observed_at = parse_timestamp(snapshot.get("observed_at"))
    if observed_at is None:
        raise GuardError("preflight observed_at is invalid")
    age = (datetime.now(timezone.utc) - observed_at).total_seconds()
    if age < -60 or age > MAX_PREFLIGHT_AGE_SECONDS:
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
    review_decision = merge_state.get("review_decision")
    if not isinstance(review_decision, str):
        raise GuardError("preflight review decision evidence is missing")
    if review_decision.upper() in {"CHANGES_REQUESTED", "REVIEW_REQUIRED"}:
        raise GuardError("preflight review decision blocks merge")

    checks = snapshot.get("checks")
    if not isinstance(checks, list) or not checks:
        raise GuardError("preflight checks evidence is missing")
    saw_pending = False
    blocking_states = {
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
    pending_states = {"expected", "in_progress", "pending", "queued", "requested", "waiting"}
    success_states = {"completed", "pass", "passed", "success", "successful"}
    known_states = blocking_states | pending_states | success_states
    for check in checks:
        if not isinstance(check, dict):
            raise GuardError("preflight check entry is invalid")
        states = {
            str(value).strip().casefold()
            for value in (check.get("bucket"), check.get("state"), check.get("conclusion"))
            if value is not None
        }
        if not states or "" in states:
            raise GuardError("preflight check entry has no valid state evidence")
        if states - known_states:
            raise GuardError("preflight contains an unknown check state")
        if states.intersection(blocking_states):
            raise GuardError("preflight contains a failed or non-successful check")
        if states.intersection(pending_states):
            saw_pending = True
            continue
        if not states.intersection(success_states):
            raise GuardError("preflight contains an unknown check state")
    if verdict == "pending" and not saw_pending:
        raise GuardError("pending preflight has no pending check evidence")
    if verdict == "mergeable" and saw_pending:
        raise GuardError("mergeable preflight still has pending checks")

    validate_artifacts(snapshot, risk_tier)
    repo, pr_number, head_sha = validate_target(
        snapshot.get("repo"), snapshot.get("pr_number"), snapshot.get("head_sha")
    )
    validate_pr_url(snapshot.get("pr_url"), repo, pr_number)
    if not isinstance(snapshot.get("base"), str) or not snapshot["base"].strip():
        raise GuardError("preflight base branch is missing")
    if not isinstance(snapshot.get("head"), str) or not snapshot["head"].strip():
        raise GuardError("preflight head branch is missing")
    reviews = snapshot.get("reviews")
    if not isinstance(reviews, list) or not reviews:
        raise GuardError("preflight review evidence is missing")
    allowed_review_states = {"APPROVED", "COMMENTED", "DISMISSED"}
    for review in reviews:
        author = review.get("author") if isinstance(review, dict) else None
        author_login = author.get("login") if isinstance(author, dict) else None
        state = review.get("state") if isinstance(review, dict) else None
        if not isinstance(author_login, str) or not author_login.strip():
            raise GuardError("preflight review author evidence is invalid")
        if state in {"CHANGES_REQUESTED", "PENDING"}:
            raise GuardError("preflight review evidence blocks merge")
        if state not in allowed_review_states:
            raise GuardError("preflight review state evidence is invalid")
    warnings = snapshot.get("warnings")
    if not isinstance(warnings, list) or any(not isinstance(warning, str) for warning in warnings):
        raise GuardError("preflight warnings evidence is missing")
    branch_policy = snapshot.get("branch_policy")
    if (
        not isinstance(branch_policy, dict)
        or not isinstance(branch_policy.get("protected"), bool)
        or not isinstance(branch_policy.get("queue_required"), bool)
    ):
        raise GuardError("preflight branch and queue policy evidence is missing")
    if mode == "merge-queue" and branch_policy["queue_required"] is not True:
        raise GuardError("merge-queue mode requires a queue-enabled branch")
    if mode != "merge-queue" and branch_policy["queue_required"] is True:
        raise GuardError("queue-required branch must use merge-queue mode")
    return repo, pr_number, head_sha


def read_body(args: argparse.Namespace) -> str:
    if args.body is not None and args.body_file is not None:
        raise GuardError("use only one of --body and --body-file")
    if args.body_file is not None:
        return Path(args.body_file).read_text(encoding="utf-8")
    return args.body or ""


def build_command(args: argparse.Namespace) -> dict[str, Any]:
    snapshot = load_object(args.preflight)
    repo, pr_number, head_sha = validate_preflight(
        snapshot,
        args.delayed_intent,
        args.task_id,
        args.acceptance_scope,
        args.repair_cycle_count,
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
            raise GuardError("the explicit squash strategy is required")
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
        "task_id": args.task_id,
        "acceptance_scope": snapshot["acceptance_scope"],
        "repair_cycle_count": args.repair_cycle_count,
        "preflight_sha256": hashlib.sha256(
            json.dumps(snapshot, separators=(",", ":"), sort_keys=True).encode("utf-8")
        ).hexdigest(),
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


def provider_result(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any], str]:
    if args.fixture:
        fixture = load_object(args.fixture)
        pr_view = fixture.get("pr_view")
        commit = fixture.get("commit")
        if not isinstance(pr_view, dict) or not isinstance(commit, dict):
            raise GuardError("fixture requires pr_view and commit objects")
        validate_pr_url(pr_view.get("url"), args.repo, args.pr)
        return pr_view, commit, "fixture"

    fields = "state,mergedAt,mergeCommit,headRefOid,baseRefName,url"
    pr_view = run_json(["gh", "pr", "view", str(args.pr), "--repo", args.repo, "--json", fields])
    merge_commit = pr_view.get("mergeCommit")
    merge_sha = merge_commit.get("oid") if isinstance(merge_commit, dict) else None
    if not isinstance(merge_sha, str) or not SHA_PATTERN.fullmatch(merge_sha):
        raise GuardError("provider did not report a valid merge commit SHA")
    commit = run_json(["gh", "api", f"repos/{args.repo}/commits/{merge_sha}"])
    validate_pr_url(pr_view.get("url"), args.repo, args.pr)
    return pr_view, commit, "provider"


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
        "task_id": args.task_id,
        "mode": args.mode,
        "acceptance_scope": args.acceptance_scope,
        "repair_cycle_count": args.repair_cycle_count,
        "preflight_sha256": args.preflight_sha256.lower(),
        "expected_base": args.expected_base,
        "expected_head_sha": args.expected_head_sha.lower(),
        "observed_at": utc_now(),
        "message_policy": "forbidden_co_authored_by_trailer_absent",
        "evidence_source": "fixture" if args.fixture else "provider",
        "authoritative": False,
        "failure_reasons": [],
    }
    try:
        validate_target(args.repo, args.pr, args.expected_head_sha)
        if not TASK_ID_PATTERN.fullmatch(args.task_id):
            raise GuardError("postverify task ID is invalid")
        if not args.acceptance_scope.strip():
            raise GuardError("postverify acceptance scope is blank")
        if args.repair_cycle_count < 0 or args.repair_cycle_count > max(cap for _, cap in RISK_TIERS.values()):
            raise GuardError("postverify repair cycle count is outside the global cap")
        if not args.expected_base.strip():
            raise GuardError("postverify expected base is blank")
        if not SHA256_PATTERN.fullmatch(args.preflight_sha256):
            raise GuardError("postverify preflight digest is invalid")
        pr_view, commit, evidence_source = provider_result(args)
        provider_head = pr_view.get("headRefOid")
        merge_commit = pr_view.get("mergeCommit")
        merge_sha = merge_commit.get("oid") if isinstance(merge_commit, dict) else None
        commit_sha = commit.get("sha")
        commit_data = commit.get("commit")
        message = commit_data.get("message") if isinstance(commit_data, dict) else None

        receipt.update(
            {
                "provider_state": pr_view.get("state"),
                "provider_url": pr_view.get("url"),
                "provider_base": pr_view.get("baseRefName"),
                "provider_head_sha": provider_head,
                "merge_commit_sha": merge_sha,
                "evidence_source": evidence_source,
                "authoritative": evidence_source == "provider",
            }
        )
        failures: list[str] = []
        if pr_view.get("state") != "MERGED":
            failures.append("provider_state_not_merged")
        if pr_view.get("baseRefName") != args.expected_base:
            failures.append("provider_base_mismatch")
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
        if failures:
            receipt["outcome"] = "failed"
        elif evidence_source == "provider":
            receipt["outcome"] = "clean"
        else:
            receipt["outcome"] = "fixture_clean"
    except (GuardError, OSError, json.JSONDecodeError) as error:
        receipt["failure_reasons"] = [str(error)]

    atomic_write(receipt_path, receipt)
    print(json.dumps(receipt, indent=2, sort_keys=True))
    return 0 if receipt["outcome"] == "clean" and receipt["authoritative"] else 1


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    subparsers = root.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build", help="Build a guarded gh pr merge argv")
    build.add_argument("--preflight", required=True)
    build.add_argument("--task-id", required=True)
    build.add_argument("--acceptance-scope", required=True)
    build.add_argument("--repair-cycle-count", required=True, type=int)
    build.add_argument("--strategy", choices=["squash"])
    build.add_argument("--subject")
    build.add_argument("--body")
    build.add_argument("--body-file")
    build.add_argument("--delayed-intent", action="store_true")

    verify = subparsers.add_parser("postverify", help="Verify the actual provider merge commit message")
    verify.add_argument("--repo", required=True)
    verify.add_argument("--pr", required=True, type=int)
    verify.add_argument("--task-id", required=True)
    verify.add_argument("--mode", required=True, choices=sorted(ACTUAL_MODES))
    verify.add_argument("--acceptance-scope", required=True)
    verify.add_argument("--repair-cycle-count", required=True, type=int)
    verify.add_argument("--expected-base", required=True)
    verify.add_argument("--expected-head-sha", required=True)
    verify.add_argument("--preflight-sha256", required=True)
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
