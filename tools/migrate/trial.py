#!/usr/bin/env python3
"""Trial build: compile this tree against the target Zephyr and harvest
every diagnostic as a finding (source = "build").

The static rule pack only knows what somebody wrote a rule for. The trial
build is the ground truth for what else breaks.
"""
from __future__ import annotations

import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

from common import MIGRATION, REPO, board_name, boards, write_json
from scan import build_inventory, summarize

WS = REPO / "scripts" / "ws.sh"
LOGS = REPO / "build" / "logs"
TARGET = "v4.3"

# (regex, category, stream, title). First match wins.
CLASSIFIERS = [
    (r"undefined symbol (\w+)", "kconfig", "foundation", "Kconfig symbol no longer exists: {0}"),
    (r"No board named '([\w@.]+)'|Invalid BOARD", "board-model", "board", "Board not found by the hardware model v2 loader"),
    (r"devicetree error: (.*)", "devicetree", "board", "Devicetree error: {0}"),
    (r"‘?(DT_N_\w+)’? was not declared", "devicetree", "foundation", "Devicetree node or property missing from the target build: {0}"),
    (r"has no member named ‘(\w+)’", "api", "can", "Struct member removed: {0}"),
    (r"‘(\w+)’ was not declared in this scope|‘(\w+)’ undeclared", "api", "foundation", "Identifier no longer provided: {0}"),
    (r"\[-Wdouble-promotion\]", "numerics", "numerics", "Implicit float to double promotion"),
    (r"ambiguating new declaration of ‘void _posix_zephyr_main\(\)’|return type of ‘main’", "api", "foundation", "main() must return int"),
    (r"warning: (.*)", "toolchain", "numerics", "{0}"),
    (r"error: (.*)", "api", "foundation", "{0}"),
]
DIAG_RE = re.compile(r"^(?P<file>[^\s:]+):(?P<line>\d+)(?::\d+)?: (?P<kind>warning|error|fatal error): (?P<msg>.*)$")
LOOSE_RE = re.compile(r"^(?P<file>[^\s:]+):(?P<line>\d+): (?P<kind>warning): (?P<msg>.*)$")
GLOBAL_RE = re.compile(r"^(?:CMake Error.*|devicetree error: .*|No board named .*|error: Aborting due to Kconfig warnings)$")


def classify(message: str) -> tuple[str, str, str]:
    for pattern, category, stream, title in CLASSIFIERS:
        match = re.search(pattern, message)
        if match:
            groups = [g for g in match.groups() if g]
            return category, stream, title.format(*(groups or [""]))[:140]
    return "toolchain", "foundation", message[:140]


def harvest(log: str, step: str) -> list[dict]:
    findings, seen = [], set()
    for raw in log.splitlines():
        line = raw.strip()
        match = DIAG_RE.match(line) or LOOSE_RE.match(line)
        if match:
            path = match["file"]
            if not path.startswith(str(REPO)):
                continue
            rel = str(Path(path).relative_to(REPO))
            number, message, kind = int(match["line"]), match["msg"], match["kind"]
        elif GLOBAL_RE.match(line) and "Aborting" not in line and not line.startswith("CMake Error"):
            rel, number, message, kind = "(build)", 0, line, "error"
        else:
            continue
        category, stream, title = classify(message)
        key = (rel, number, title)
        if key in seen:
            continue
        seen.add(key)
        findings.append({
            "id": f"BUILD:{rel}:{number}:{len(findings)}:{step}",
            "rule": f"BUILD-{category.upper()}",
            "source": "build",
            "title": title,
            "category": category,
            "severity": "breaking" if "error" in kind else "deprecated",
            "since": None,
            "removed": None,
            "stream": stream,
            "file": rel,
            "line": number,
            "snippet": message[:200],
            "context": [],
            "fix": f"Reported by the Zephyr {TARGET} trial build ({step}).",
            "ref": "https://docs.zephyrproject.org/latest/releases/index.html",
            "step": step,
        })
    return findings


def main() -> int:
    steps = [("tests", ["target", "test"])] + [(board_name(b), ["target", "build", b]) for b in boards()]
    results, findings = [], []
    for step, args in steps:
        proc = subprocess.run([str(WS), *args], capture_output=True, text=True)
        log_name = "tests" if step == "tests" else args[2]
        log_path = LOGS / f"{TARGET}-{log_name}.log"
        log = log_path.read_text(errors="replace") if log_path.exists() else proc.stdout
        found = harvest(log, step)
        results.append({"step": step, "exit": proc.returncode, "diagnostics": len(found)})
        print(f"  {step:<16} exit {proc.returncode}  {len(found)} diagnostics")
        findings += found
    # the same source line is reported once per board; keep the first
    unique, seen = [], set()
    for f in findings:
        key = (f["file"], f["line"], f["title"])
        if key not in seen:
            seen.add(key)
            unique.append(f)
    inventory = build_inventory(keep_build=False)
    inventory["findings"] += unique
    inventory["summary"] = summarize(inventory["findings"])
    inventory["trial"] = {"zephyr": TARGET, "steps": results}
    write_json(MIGRATION / "inventory.json", inventory)
    by_cat = Counter(f["category"] for f in unique)
    print(f"trial build on Zephyr {TARGET}: {sum(r['exit'] != 0 for r in results)}/{len(results)} steps fail, "
          f"{len(unique)} build findings {dict(by_cat)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
