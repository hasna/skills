#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


SCRIPT = Path(__file__).with_name("merge_pr_guard.py")
FIXTURES = Path(__file__).parents[1] / "tests" / "fixtures"
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("merge_pr_guard", SCRIPT)
assert SPEC and SPEC.loader
GUARD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GUARD)

REPO = "hasna/tai"
PR_NUMBER = 4
HEAD_SHA = "2797e3264c416018c06608434c0c57340f647330"
ACCEPTANCE_SCOPE = "skills-merge-trailer-hardening-v1"
TASK_ID = "fae9ac3b-5af9-4f15-aaca-748e2a5da394"


def artifact(identity: str) -> dict[str, object]:
    return {
        "repository": REPO,
        "pr_number": PR_NUMBER,
        "head_sha": HEAD_SHA,
        "acceptance_scope": ACCEPTANCE_SCOPE,
        "reviewer_identity": identity,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "verdict": "approved",
        "checked_risks_summary": "Checked exact-head merge and message provenance.",
        "blocking_findings": [],
    }


def preflight(mode: str = "immediate-merge", verdict: str = "mergeable") -> dict[str, object]:
    snapshot: dict[str, object] = {
        "task_id": TASK_ID,
        "mode": mode,
        "risk_tier": {"declared": "elevated", "effective": "elevated", "source": "explicit"},
        "acceptance_scope": ACCEPTANCE_SCOPE,
        "required_reviewer_artifacts": 2,
        "repair_cycles": {"count": 0, "cap": 2},
        "verdict": verdict,
        "repo": REPO,
        "pr_number": PR_NUMBER,
        "pr_url": "https://github.com/hasna/tai/pull/4",
        "base": "main",
        "head": "hasna:ci/provider-native-validation",
        "head_sha": HEAD_SHA,
        "merge_state": {
            "state": "OPEN",
            "is_draft": False,
            "mergeable": "MERGEABLE",
            "merge_state_status": "CLEAN",
            "review_decision": "APPROVED",
        },
        "checks": [{"name": "ci", "bucket": "pass", "state": "SUCCESS"}],
        "reviews": [{"author": {"login": "reviewer-a"}, "state": "APPROVED"}],
        "reviewer_artifacts": [artifact("reviewer-a"), artifact("reviewer-b")],
        "worker_identity": "worker",
        "executor_identity": "executor",
        "branch_policy": {"protected": True, "queue_required": mode == "merge-queue"},
        "blocking_reasons": [],
        "warnings": [],
        "observed_at": datetime.now(timezone.utc).isoformat(),
    }
    if verdict == "pending":
        snapshot["merge_state"]["merge_state_status"] = "UNSTABLE"
        snapshot["checks"] = [{"name": "ci", "bucket": "pending", "state": "PENDING"}]
    return snapshot


class GuardCliTests(unittest.TestCase):
    def run_cli(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def build(
        self,
        directory: Path,
        *args: str,
        snapshot: dict[str, object] | None = None,
        expected_scope: str = ACCEPTANCE_SCOPE,
        expected_repair_cycle_count: int = 0,
    ):
        snapshot_path = directory / "preflight.json"
        snapshot_path.write_text(json.dumps(snapshot or preflight()), encoding="utf-8")
        result = self.run_cli(
            "build",
            "--preflight",
            str(snapshot_path),
            "--task-id",
            TASK_ID,
            "--acceptance-scope",
            expected_scope,
            "--repair-cycle-count",
            str(expected_repair_cycle_count),
            *args,
        )
        return result, json.loads(result.stdout) if result.stdout else None

    def provenance(
        self, directory: Path, body: str = ""
    ) -> tuple[Path, Path, dict[str, object]]:
        result, plan = self.build(
            directory,
            "--strategy",
            "squash",
            "--subject",
            "fix: safe",
            f"--body={body}",
        )
        if result.returncode != 0 or not isinstance(plan, dict):
            raise AssertionError(result.stderr)
        plan_path = directory / "command-plan.json"
        plan_path.write_text(json.dumps(plan), encoding="utf-8")
        return directory / "preflight.json", plan_path, plan

    def postverify_contract_args(
        self,
        preflight_path: Path,
        plan_path: Path,
        plan: dict[str, object],
        repo: str = REPO,
        pr_number: int = PR_NUMBER,
    ) -> list[str]:
        return [
            "--repo",
            repo,
            "--pr",
            str(pr_number),
            "--task-id",
            TASK_ID,
            "--mode",
            "immediate-merge",
            "--acceptance-scope",
            ACCEPTANCE_SCOPE,
            "--repair-cycle-count",
            "0",
            "--expected-base",
            "main",
            "--expected-head-sha",
            HEAD_SHA,
            "--preflight-sha256",
            str(plan["preflight_sha256"]),
            "--command-argv-sha256",
            str(plan["command_argv_sha256"]),
            "--preflight",
            str(preflight_path),
            "--command-plan",
            str(plan_path),
        ]

    def test_multi_commit_squash_builds_explicit_message_and_exact_head_cas(self) -> None:
        raw = json.loads((FIXTURES / "multi-commit-synthesized.json").read_text(encoding="utf-8"))
        self.assertEqual(len(raw["source_commits"]), 2)
        self.assertTrue(all(not GUARD.forbidden_trailer_lines(commit["message"]) for commit in raw["source_commits"]))
        with tempfile.TemporaryDirectory() as temporary:
            result, plan = self.build(
                Path(temporary),
                "--strategy",
                "squash",
                "--subject",
                "ci: add provider-native validation workflow",
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = plan["argv"]
        self.assertEqual(argv[:3], ["gh", "pr", "merge"])
        self.assertIn("--squash", argv)
        self.assertEqual(argv[argv.index("--subject") + 1], "ci: add provider-native validation workflow")
        self.assertEqual(argv[argv.index("--body") + 1], "")
        self.assertEqual(argv[argv.index("--match-head-commit") + 1], HEAD_SHA)
        self.assertEqual(plan["base"], "main")
        self.assertEqual(len(plan["preflight_sha256"]), 64)
        self.assertEqual(len(plan["command_argv_sha256"]), 64)
        self.assertTrue({"--admin", "--force", "--delete-branch"}.isdisjoint(argv))
        self.assertNotIn("push", argv)

    def test_omitted_and_explicit_empty_body_are_identical(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            omitted, omitted_plan = self.build(directory, "--strategy", "squash", "--subject", "fix: safe")
            explicit, explicit_plan = self.build(
                directory, "--strategy", "squash", "--subject", "fix: safe", "--body", ""
            )
        self.assertEqual(omitted.returncode, 0)
        self.assertEqual(explicit.returncode, 0)
        self.assertEqual(omitted_plan["argv"], explicit_plan["argv"])

    def test_custom_body_normalizes_line_endings_deterministically(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, plan = self.build(
                Path(temporary),
                "--strategy",
                "squash",
                "--subject",
                "fix: safe",
                "--body",
                "first\r\nsecond\rthird",
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(plan["argv"][plan["argv"].index("--body") + 1], "first\nsecond\nthird")

    def test_co_authored_by_case_and_whitespace_variants_are_rejected(self) -> None:
        variants = [
            "Co-Authored-By: person <person@example.invalid>",
            "co-authored-by : person <person@example.invalid>",
            "\tCO - AUTHORED - BY\t: person <person@example.invalid>",
            "Co Authored By: person <person@example.invalid>",
        ]
        for variant in variants:
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as temporary:
                result, _ = self.build(
                    Path(temporary),
                    "--strategy",
                    "squash",
                    "--subject",
                    "fix: safe",
                    "--body",
                    f"Summary\n\n{variant}",
                )
            self.assertEqual(result.returncode, 2)
            self.assertIn("forbidden Co-Authored-By trailer", result.stderr)

    def test_co_authored_by_subject_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, _ = self.build(
                Path(temporary),
                "--strategy",
                "squash",
                "--subject",
                "CO - AUTHORED - BY : person <person@example.invalid>",
            )
        self.assertEqual(result.returncode, 2)
        self.assertIn("forbidden Co-Authored-By trailer", result.stderr)

    def test_auto_merge_requires_explicit_delayed_intent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            rejected, _ = self.build(
                directory,
                "--strategy",
                "squash",
                "--subject",
                "fix: safe",
                snapshot=preflight("auto-merge"),
            )
            accepted, plan = self.build(
                directory,
                "--strategy",
                "squash",
                "--subject",
                "fix: safe",
                "--delayed-intent",
                snapshot=preflight("auto-merge"),
            )
        self.assertEqual(rejected.returncode, 2)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertIn("--auto", plan["argv"])

    def test_non_mergeable_or_identity_colliding_preflight_fails_closed(self) -> None:
        blocked = preflight()
        blocked["verdict"] = "not_mergeable"
        collision = preflight()
        collision["reviewer_artifacts"][0]["reviewer_identity"] = "executor"
        for snapshot in (blocked, collision):
            with tempfile.TemporaryDirectory() as temporary:
                result, _ = self.build(
                    Path(temporary),
                    "--strategy",
                    "squash",
                    "--subject",
                    "fix: safe",
                    snapshot=snapshot,
                )
            self.assertEqual(result.returncode, 2)

    def test_missing_worker_or_branch_policy_evidence_fails_closed(self) -> None:
        missing_worker = preflight()
        del missing_worker["worker_identity"]
        missing_policy = preflight()
        del missing_policy["branch_policy"]
        for snapshot in (missing_worker, missing_policy):
            with tempfile.TemporaryDirectory() as temporary:
                result, _ = self.build(
                    Path(temporary),
                    "--strategy",
                    "squash",
                    "--subject",
                    "fix: safe",
                    snapshot=snapshot,
                )
            self.assertEqual(result.returncode, 2)

    def test_missing_review_decision_and_stateless_check_fail_closed(self) -> None:
        missing_decision = preflight()
        del missing_decision["merge_state"]["review_decision"]
        blank_decision = preflight()
        blank_decision["merge_state"]["review_decision"] = ""
        invented_decision = preflight()
        invented_decision["merge_state"]["review_decision"] = "INVENTED"
        stateless_check = preflight()
        stateless_check["checks"] = [{}]
        completed_without_conclusion = preflight()
        completed_without_conclusion["checks"] = [{"state": "COMPLETED"}]
        for snapshot in (
            missing_decision,
            blank_decision,
            invented_decision,
            stateless_check,
            completed_without_conclusion,
        ):
            with tempfile.TemporaryDirectory() as temporary:
                result, _ = self.build(
                    Path(temporary),
                    "--strategy",
                    "squash",
                    "--subject",
                    "fix: safe",
                    snapshot=snapshot,
                )
            self.assertEqual(result.returncode, 2)

    def test_empty_or_conflicting_check_and_review_evidence_fails_closed(self) -> None:
        empty_checks = preflight()
        empty_checks["checks"] = []
        conflicting_check = preflight()
        conflicting_check["checks"] = [{"bucket": "pass", "state": "invented"}]
        empty_reviews = preflight()
        empty_reviews["reviews"] = []
        malformed_review = preflight()
        malformed_review["reviews"] = [{"state": "APPROVED"}]
        blocking_review = preflight()
        blocking_review["reviews"] = [
            {"author": {"login": "reviewer-a"}, "state": "CHANGES_REQUESTED"}
        ]
        for snapshot in (
            empty_checks,
            conflicting_check,
            empty_reviews,
            malformed_review,
            blocking_review,
        ):
            with tempfile.TemporaryDirectory() as temporary:
                result, _ = self.build(
                    Path(temporary),
                    "--strategy",
                    "squash",
                    "--subject",
                    "fix: safe",
                    snapshot=snapshot,
                )
            self.assertEqual(result.returncode, 2)

    def test_merge_and_rebase_strategies_have_no_bypass(self) -> None:
        for strategy in ("merge", "rebase"):
            with self.subTest(strategy=strategy), tempfile.TemporaryDirectory() as temporary:
                result, _ = self.build(
                    Path(temporary),
                    "--strategy",
                    strategy,
                    "--subject",
                    "fix: safe",
                )
            self.assertEqual(result.returncode, 2)

    def test_scope_cycle_and_freshness_are_executor_bound(self) -> None:
        changed_scope = preflight()
        changed_scope["acceptance_scope"] = "changed-scope"
        changed_scope["reviewer_artifacts"][0]["acceptance_scope"] = "changed-scope"
        changed_scope["reviewer_artifacts"][1]["acceptance_scope"] = "changed-scope"
        changed_cycle = preflight()
        changed_cycle["repair_cycles"]["count"] = 1
        stale = preflight()
        stale["observed_at"] = "2020-01-01T00:00:00Z"
        for snapshot in (changed_scope, changed_cycle, stale):
            with tempfile.TemporaryDirectory() as temporary:
                result, _ = self.build(
                    Path(temporary),
                    "--strategy",
                    "squash",
                    "--subject",
                    "fix: safe",
                    snapshot=snapshot,
                )
            self.assertEqual(result.returncode, 2)

    def test_boolean_counts_and_unicode_equivalent_reviewers_fail_closed(self) -> None:
        boolean_count = preflight()
        boolean_count["risk_tier"] = {"declared": "routine", "effective": "routine", "source": "explicit"}
        boolean_count["required_reviewer_artifacts"] = True
        boolean_count["repair_cycles"]["cap"] = 1
        boolean_count["reviewer_artifacts"] = boolean_count["reviewer_artifacts"][:1]
        boolean_cap = preflight()
        boolean_cap["risk_tier"] = {"declared": "routine", "effective": "routine", "source": "explicit"}
        boolean_cap["required_reviewer_artifacts"] = 1
        boolean_cap["repair_cycles"]["cap"] = True
        boolean_cap["reviewer_artifacts"] = boolean_cap["reviewer_artifacts"][:1]
        duplicate_reviewer = preflight()
        duplicate_reviewer["reviewer_artifacts"][0]["reviewer_identity"] = "reviewer-\u212a"
        duplicate_reviewer["reviewer_artifacts"][1]["reviewer_identity"] = "reviewer-K"
        for snapshot in (boolean_count, boolean_cap, duplicate_reviewer):
            with tempfile.TemporaryDirectory() as temporary:
                result, _ = self.build(
                    Path(temporary),
                    "--strategy",
                    "squash",
                    "--subject",
                    "fix: safe",
                    snapshot=snapshot,
                )
            self.assertEqual(result.returncode, 2)

    def test_stale_artifact_and_failed_check_fail_closed(self) -> None:
        stale = preflight()
        stale["reviewer_artifacts"][0]["timestamp"] = "2020-01-01T00:00:00Z"
        failed_check = preflight()
        failed_check["checks"] = [{"name": "ci", "bucket": "fail", "state": "FAILURE"}]
        for snapshot in (stale, failed_check):
            with tempfile.TemporaryDirectory() as temporary:
                result, _ = self.build(
                    Path(temporary),
                    "--strategy",
                    "squash",
                    "--subject",
                    "fix: safe",
                    snapshot=snapshot,
                )
            self.assertEqual(result.returncode, 2)

    def test_merge_queue_has_exact_head_cas_and_no_strategy_or_mutation_flags(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result, plan = self.build(Path(temporary), snapshot=preflight("merge-queue"))
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = plan["argv"]
        self.assertEqual(argv[argv.index("--match-head-commit") + 1], HEAD_SHA)
        self.assertTrue(
            {"--squash", "--merge", "--rebase", "--admin", "--force", "--delete-branch", "--auto"}.isdisjoint(argv)
        )

    def test_pending_merge_queue_requires_delayed_intent_without_auto_flag(self) -> None:
        pending = preflight("merge-queue", "pending")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            rejected, _ = self.build(directory, snapshot=pending)
            accepted, plan = self.build(directory, "--delayed-intent", snapshot=pending)
        self.assertEqual(rejected.returncode, 2)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertNotIn("--auto", plan["argv"])
        self.assertIn("--match-head-commit", plan["argv"])

    def test_synthesized_provider_trailer_writes_failed_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            preflight_path, plan_path, plan = self.provenance(directory)
            receipt = directory / "postverify.json"
            result = self.run_cli(
                "postverify",
                *self.postverify_contract_args(preflight_path, plan_path, plan),
                "--fixture",
                str(FIXTURES / "multi-commit-synthesized.json"),
                "--receipt",
                str(receipt),
            )
            durable = json.loads(receipt.read_text(encoding="utf-8"))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(durable["outcome"], "failed")
        self.assertIn("forbidden_co_authored_by_trailer", durable["failure_reasons"])
        self.assertTrue(durable["forbidden_trailer_line_numbers"])
        self.assertNotIn("message", durable)
        self.assertEqual(durable["evidence_source"], "fixture")
        self.assertIs(durable["authoritative"], False)

    def test_trailer_free_fixture_is_clean_but_cannot_complete_live_postverify(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            preflight_path, plan_path, plan = self.provenance(directory)
            receipt = directory / "postverify.json"
            result = self.run_cli(
                "postverify",
                *self.postverify_contract_args(preflight_path, plan_path, plan),
                "--fixture",
                str(FIXTURES / "trailer-free-provider.json"),
                "--receipt",
                str(receipt),
            )
            durable = json.loads(receipt.read_text(encoding="utf-8"))
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(durable["outcome"], "fixture_clean")
        self.assertEqual(durable["forbidden_trailer_line_numbers"], [])
        self.assertEqual(durable["message_policy"], "forbidden_co_authored_by_trailer_absent")
        self.assertEqual(durable["task_id"], TASK_ID)
        self.assertEqual(durable["mode"], "immediate-merge")
        self.assertEqual(durable["acceptance_scope"], ACCEPTANCE_SCOPE)
        self.assertEqual(durable["repair_cycle_count"], 0)
        self.assertEqual(durable["preflight_sha256"], plan["preflight_sha256"])
        self.assertEqual(durable["command_argv_sha256"], plan["command_argv_sha256"])
        self.assertEqual(durable["provider_url"], "https://github.com/hasna/tai/pull/4")
        self.assertEqual(durable["provider_base"], "main")
        self.assertEqual(durable["evidence_source"], "fixture")
        self.assertIs(durable["authoritative"], False)

    def test_fixture_target_mismatch_writes_failed_non_authoritative_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            preflight_path, plan_path, plan = self.provenance(directory)
            receipt = directory / "postverify.json"
            result = self.run_cli(
                "postverify",
                *self.postverify_contract_args(
                    preflight_path,
                    plan_path,
                    plan,
                    repo="hasna/not-tai",
                    pr_number=999,
                ),
                "--fixture",
                str(FIXTURES / "trailer-free-provider.json"),
                "--receipt",
                str(receipt),
            )
            durable = json.loads(receipt.read_text(encoding="utf-8"))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(durable["outcome"], "failed")
        self.assertNotEqual(durable.get("authoritative"), True)

    def test_postverify_recomputes_preflight_and_rejects_plan_provenance_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            preflight_path, plan_path, plan = self.provenance(directory)
            plan["preflight_sha256"] = "f" * 64
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            receipt = directory / "postverify.json"
            result = self.run_cli(
                "postverify",
                *self.postverify_contract_args(preflight_path, plan_path, plan),
                "--fixture",
                str(FIXTURES / "trailer-free-provider.json"),
                "--receipt",
                str(receipt),
            )
            durable = json.loads(receipt.read_text(encoding="utf-8"))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(durable["outcome"], "failed")
        self.assertIs(durable["authoritative"], False)

    def test_postverify_rejects_command_plan_argv_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            preflight_path, plan_path, plan = self.provenance(directory)
            plan["argv"].append("--admin")
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            receipt = directory / "postverify.json"
            result = self.run_cli(
                "postverify",
                *self.postverify_contract_args(preflight_path, plan_path, plan),
                "--fixture",
                str(FIXTURES / "trailer-free-provider.json"),
                "--receipt",
                str(receipt),
            )
            durable = json.loads(receipt.read_text(encoding="utf-8"))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(durable["outcome"], "failed")
        self.assertIs(durable["authoritative"], False)

    def test_postverify_rejects_saved_subject_or_body_mutation(self) -> None:
        for option in ("--subject", "--body"):
            with self.subTest(option=option), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                preflight_path, plan_path, plan = self.provenance(directory)
                option_index = plan["argv"].index(option)
                plan["argv"][option_index + 1] = "changed but trailer-free"
                plan_path.write_text(json.dumps(plan), encoding="utf-8")
                receipt = directory / "postverify.json"
                result = self.run_cli(
                    "postverify",
                    *self.postverify_contract_args(preflight_path, plan_path, plan),
                    "--fixture",
                    str(FIXTURES / "trailer-free-provider.json"),
                    "--receipt",
                    str(receipt),
                )
                durable = json.loads(receipt.read_text(encoding="utf-8"))
            self.assertEqual(result.returncode, 1)
            self.assertEqual(durable["outcome"], "failed")
            self.assertTrue(
                any("command argv digest mismatch" in reason for reason in durable["failure_reasons"])
            )
            self.assertIs(durable["authoritative"], False)

    def test_postverify_persists_failed_receipt_for_non_utf8_plan(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            preflight_path, plan_path, plan = self.provenance(directory)
            plan_path.write_bytes(b"\xff")
            receipt = directory / "postverify.json"
            result = self.run_cli(
                "postverify",
                *self.postverify_contract_args(preflight_path, plan_path, plan),
                "--fixture",
                str(FIXTURES / "trailer-free-provider.json"),
                "--receipt",
                str(receipt),
            )
            durable = json.loads(receipt.read_text(encoding="utf-8"))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(durable["outcome"], "failed")
        self.assertIs(durable["authoritative"], False)
        self.assertNotIn("Traceback", result.stderr)

    def test_literal_command_words_remain_custom_body_data(self) -> None:
        for body in ("push", "--admin"):
            with self.subTest(body=body), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                preflight_path, plan_path, plan = self.provenance(directory, body)
                receipt = directory / "postverify.json"
                result = self.run_cli(
                    "postverify",
                    *self.postverify_contract_args(preflight_path, plan_path, plan),
                    "--fixture",
                    str(FIXTURES / "trailer-free-provider.json"),
                    "--receipt",
                    str(receipt),
                )
                durable = json.loads(receipt.read_text(encoding="utf-8"))
            self.assertEqual(result.returncode, 1)
            self.assertEqual(durable["outcome"], "fixture_clean")
            self.assertIs(durable["authoritative"], False)


if __name__ == "__main__":
    unittest.main()
