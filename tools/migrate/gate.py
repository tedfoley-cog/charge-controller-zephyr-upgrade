#!/usr/bin/env python3
"""No-regression gate.

Runs the unit tests and board builds for the OS version the tree is on,
records the evidence and compares it with migration/evidence/baseline.json.

  gate.py --capture-baseline      record the v3.2 baseline (run once on main)
  gate.py                         gate the current tree
  gate.py --require-all-boards    integration gate: no board may be pending
  gate.py --base-ref origin/main  changes under app/src must add unit tests versus that ref
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

from common import MIGRATION, REPO, board_name, boards, read_json, write_json

WS = REPO / "scripts" / "ws.sh"
LOGS = REPO / "build" / "logs"
FLASH_BUDGET_PCT = 8.0  # allowed flash growth per board versus the baseline
UNITY_RE = re.compile(r"^(\d+) Tests (\d+) Failures (\d+) Ignored", re.M)
MEM_RE = re.compile(r"^\s*(FLASH|SRAM|RAM):\s+(\d+) B\s+(\d+) (KB|MB|GB)", re.M)
WARN_RE = re.compile(r"^(\S+?):(\d+):\d+: warning: (.*?)( \[(-W[\w-]+)\])?$", re.M)


def tree_version() -> str:
    match = re.search(r"revision: (v\d+\.\d+)-branch", (REPO / "west.yml").read_text())
    return match.group(1) if match else "unknown"


def parse_tests(log: str) -> dict:
    suites = [tuple(map(int, m)) for m in UNITY_RE.findall(log)]
    return {
        "suites": len(suites),
        "total": sum(s[0] for s in suites),
        "failures": sum(s[1] for s in suites),
        "ignored": sum(s[2] for s in suites),
    }


def parse_memory(log: str) -> dict:
    scale = {"KB": 1024, "MB": 1024**2, "GB": 1024**3}
    out = {}
    for region, used, size, unit in MEM_RE.findall(log):
        out["sram" if region in ("SRAM", "RAM") else "flash"] = {"used": int(used), "size": int(size) * scale[unit]}
    return out


def parse_warnings(log: str) -> list[dict]:
    seen, out = set(), []
    for path, line, message, _, flag in WARN_RE.findall(log):
        if not path.startswith(str(REPO)):
            continue  # warnings inside Zephyr or modules are not ours to fix
        key = (path, line, message)
        if key in seen:
            continue
        seen.add(key)
        out.append({"file": str(Path(path).relative_to(REPO)), "line": int(line), "message": message, "flag": flag or None})
    return out


def is_migrated(board: str) -> bool:
    return any(REPO.glob(f"boards/*/{board}/board.yml"))


def run(workspace: str, *args: str) -> tuple[int, str]:
    proc = subprocess.run([str(WS), workspace, *args], capture_output=True, text=True)
    log_name = "tests" if args[0] == "test" else args[1]
    log = LOGS / f"{tree_version()}-{log_name}.log"
    return proc.returncode, log.read_text(errors="replace") if log.exists() else proc.stdout + proc.stderr


def collect(only_boards: list[str] | None = None, skip_boards: bool = False) -> dict:
    version = tree_version()
    on_target = version != "v3.2"
    rc, log = run("auto", "test")
    evidence = {
        "zephyr": version,
        "tests": {**parse_tests(log), "exit": rc},
        "warnings": parse_warnings(log),
        "boards": {},
    }
    for target in boards():
        name = board_name(target)
        if skip_boards or (only_boards and name not in only_boards):
            continue
        if on_target and not is_migrated(name):
            evidence["boards"][name] = {"target": target, "status": "pending"}
            continue
        rc, log = run("auto", "build", target)
        entry = {"target": target, "status": "built" if rc == 0 else "failed", **parse_memory(log)}
        evidence["boards"][name] = entry
        evidence["warnings"] += [w for w in parse_warnings(log) if w not in evidence["warnings"]]
    return evidence


def count_tests_at(ref: str | None) -> int:
    """Number of RUN_TEST registrations at a git ref, or in the working tree."""
    cmd = ["git", "grep", "-c", "RUN_TEST("] + ([ref] if ref else []) + ["--", "tests/src"]
    out = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    return sum(int(line.rsplit(":", 1)[1]) for line in out.stdout.splitlines() if line)


def changed_files(base_ref: str) -> list[str]:
    out = subprocess.run(["git", "diff", "--name-only", f"{base_ref}...HEAD"], cwd=REPO, capture_output=True, text=True)
    return out.stdout.splitlines()


def tests_delta(base_ref: str) -> dict | None:
    """A change that touches application code must add unit tests."""
    touched = [f for f in changed_files(base_ref) if f.startswith("app/src/")]
    if not touched:
        return None
    return {"base": count_tests_at(base_ref), "head": count_tests_at(None), "touched": len(touched)}


def evaluate(evidence: dict, baseline: dict, require_all: bool = False, delta: dict | None = None) -> list[dict]:
    checks = []

    def check(name, ok, detail):
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    tests, base_tests = evidence["tests"], baseline["tests"]
    check("unit tests pass", tests["exit"] == 0 and tests["failures"] == 0 and tests["total"] > 0,
          f"{tests['total']} run, {tests['failures']} failed")
    check("no unit test removed", tests["total"] >= base_tests["total"],
          f"{tests['total']} now vs {base_tests['total']} at baseline")
    if delta is not None:
        check("regression tests added for changed application code", delta["head"] > delta["base"],
              f"{delta['touched']} files under app/src changed; {delta['head'] - delta['base']:+d} test cases vs the base branch")
    for name, board in evidence["boards"].items():
        base = baseline["boards"].get(name, {})
        if board["status"] == "pending":
            if require_all:
                check(f"{name}: migrated", False, "still on hardware model v1 (pending ticket)")
            continue
        check(f"{name}: builds", board["status"] == "built", board["status"])
        if board["status"] == "built" and base.get("flash"):
            growth = 100.0 * (board["flash"]["used"] - base["flash"]["used"]) / base["flash"]["used"]
            check(f"{name}: flash budget", growth <= FLASH_BUDGET_PCT and board["flash"]["used"] <= board["flash"]["size"],
                  f"{board['flash']['used']} B ({growth:+.1f}% vs baseline, budget +{FLASH_BUDGET_PCT:.0f}%)")
            check(f"{name}: fits SRAM", board["sram"]["used"] <= board["sram"]["size"],
                  f"{board['sram']['used']} of {board['sram']['size']} B")
    now, before = len(evidence["warnings"]), len(baseline.get("warnings", []))
    # the warning ratchet only blocks the integration gate; until then it is reported
    check("no new compiler warnings in app code", now <= before or not require_all,
          f"{now} now vs {before} at baseline" + ("" if now <= before or require_all else " (blocks the integration gate)"))
    return checks


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--capture-baseline", action="store_true")
    parser.add_argument("--require-all-boards", action="store_true")
    parser.add_argument("--boards", help="comma separated board names to build (default: all)")
    parser.add_argument("--tests-only", action="store_true")
    parser.add_argument("--base-ref", help="git ref of the base branch; the tree must add unit tests versus it")
    parser.add_argument("--ticket", help="plan ticket id; evidence is written to migration/evidence/<ticket>.json")
    parser.add_argument("--out", default=str(MIGRATION / "evidence" / "current.json"))
    parser.add_argument("--print-version", action="store_true", help="print the Zephyr version this tree targets")
    args = parser.parse_args(argv)
    if args.print_version:
        print(tree_version())
        return 0

    only = args.boards.split(",") if args.boards else None
    evidence = collect(only, skip_boards=args.tests_only)
    if args.capture_baseline:
        if evidence["zephyr"] != "v3.2":
            print("baseline must be captured on the v3.2 tree", file=sys.stderr)
            return 2
        write_json(MIGRATION / "evidence" / "baseline.json", evidence)
        print(f"baseline captured: {evidence['tests']['total']} tests, {len(evidence['boards'])} boards")
        return 0 if evidence["tests"]["exit"] == 0 else 1

    baseline = read_json(MIGRATION / "evidence" / "baseline.json")
    if baseline is None:
        print("no baseline evidence; run `make baseline` on main first", file=sys.stderr)
        return 2
    delta = tests_delta(args.base_ref) if args.base_ref else None
    if args.ticket:
        evidence = {"ticket": args.ticket, **evidence}
        args.out = str(MIGRATION / "evidence" / f"{args.ticket}.json")
    evidence["checks"] = evaluate(evidence, baseline, args.require_all_boards, delta)
    evidence["verdict"] = "pass" if all(c["ok"] for c in evidence["checks"]) else "fail"
    write_json(Path(args.out), evidence)
    for c in evidence["checks"]:
        print(f"  [{'PASS' if c['ok'] else 'FAIL'}] {c['name']}: {c['detail']}")
    print(f"gate: {evidence['verdict'].upper()} (Zephyr {evidence['zephyr']})")
    return 0 if evidence["verdict"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
