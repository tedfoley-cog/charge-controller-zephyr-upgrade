#!/usr/bin/env python3
"""Turn the inventory into a ticketed migration plan (migration/plan.json).

Findings are assigned to a work stream by file ownership first (a board
directory belongs to the ticket that owns that board) and by the rule's
stream second. Tickets of the same wave must own disjoint paths.
"""
from __future__ import annotations

import sys
from collections import Counter
from itertools import combinations
from pathlib import Path

import yaml

from common import MIGRATION, REPO, SEVERITY_ORDER, glob_match, read_json, write_json

EFFORT_HOURS = {"breaking": 0.75, "deprecated": 0.25, "advisory": 0.1}  # manual estimate per finding


def load_streams(path: Path = MIGRATION / "streams.yml") -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def owner_of(finding: dict, streams: list[dict]) -> str:
    parts = finding["file"].split("/")
    if parts[0] == "boards" and len(parts) > 2:
        for stream in streams:
            if parts[2] in stream["boards"]:
                return stream["id"]
    for stream in streams:
        if finding["stream"] in stream["finding_streams"]:
            return stream["id"]
    for stream in streams:
        if any(glob_match(finding["file"], glob) for glob in stream["owns"]):
            return stream["id"]
    return streams[0]["id"]


def overlaps(a: dict, b: dict, files: list[str]) -> list[str]:
    def owned(stream):
        return {f for f in files if any(glob_match(f, g) for g in stream["owns"])}

    return sorted(owned(a) & owned(b))


def tracked_files() -> list[str]:
    import subprocess

    out = subprocess.run(["git", "ls-files"], cwd=REPO, capture_output=True, text=True, check=True)
    return out.stdout.splitlines()


def describe(stream: dict, findings: list[dict], cfg: dict) -> str:
    rules = Counter((f["rule"], f["title"]) for f in findings)
    lines = [
        "## Scope",
        f"Wave {stream['wave']} of the Zephyr v3.2 -> v4.3 upgrade. Base branch: `{cfg['integration_branch']}`.",
        "",
        "## Owned paths",
        *[f"- `{g}`" for g in stream["owns"]],
        "",
        f"## Findings ({len(findings)})",
        *[f"- {rule}: {title} ({count})" for (rule, title), count in sorted(rules.items())],
        "",
        "## Acceptance criteria",
        *[f"- {a}" for a in stream["acceptance"]],
        "",
        "## Gate",
        f"`{stream['gate']}`",
    ]
    return "\n".join(lines)


def build_plan(inventory: dict, cfg: dict, files: list[str]) -> dict:
    streams = cfg["streams"]
    by_ticket: dict[str, list[dict]] = {s["id"]: [] for s in streams}
    for finding in inventory["findings"]:
        by_ticket[owner_of(finding, streams)].append(finding)

    conflicts = []
    for a, b in combinations(streams, 2):
        if a["wave"] == b["wave"]:
            shared = overlaps(a, b, files)
            if shared:
                conflicts.append({"a": a["id"], "b": b["id"], "files": shared[:10]})

    tickets = []
    for stream in streams:
        findings = by_ticket[stream["id"]]
        severities = Counter(f["severity"] for f in findings)
        tickets.append({
            "id": stream["id"],
            "wave": stream["wave"],
            "title": stream["title"],
            "boards": stream["boards"],
            "owns": stream["owns"],
            "acceptance": stream["acceptance"],
            "gate": stream["gate"],
            "depends_on": [s["id"] for s in streams if s["wave"] < stream["wave"]],
            "findings": [f["id"] for f in findings],
            "finding_count": len(findings),
            "by_severity": {k: severities.get(k, 0) for k in SEVERITY_ORDER},
            "files": sorted({f["file"] for f in findings}),
            "manual_estimate_hours": round(sum(EFFORT_HOURS[f["severity"]] for f in findings) + 6 * len(stream["boards"]) + 4, 1),
            "description": describe(stream, findings, cfg),
        })
    waves = sorted({t["wave"] for t in tickets})
    return {
        "from": inventory["from"],
        "to": inventory["to"],
        "integration_branch": cfg["integration_branch"],
        "epic": cfg["epic"],
        "waves": [{"wave": w, "parallel": sum(t["wave"] == w for t in tickets), "tickets": [t["id"] for t in tickets if t["wave"] == w]} for w in waves],
        "tickets": tickets,
        "conflicts": conflicts,
        "manual_estimate_hours": round(sum(t["manual_estimate_hours"] for t in tickets), 1),
    }


def main() -> int:
    inventory = read_json(MIGRATION / "inventory.json")
    if inventory is None:
        print("no inventory; run `make scan` (and `make trial`) first", file=sys.stderr)
        return 2
    plan = build_plan(inventory, load_streams(), tracked_files())
    write_json(MIGRATION / "plan.json", plan)
    for ticket in plan["tickets"]:
        print(f"  wave {ticket['wave']}  {ticket['id']:<14} {ticket['finding_count']:>3} findings  {len(ticket['boards'])} boards  ~{ticket['manual_estimate_hours']}h manual")
    if plan["conflicts"]:
        for c in plan["conflicts"]:
            print(f"CONFLICT: {c['a']} and {c['b']} both own {c['files']}", file=sys.stderr)
        return 1
    print(f"plan: {len(plan['tickets'])} tickets in {len(plan['waves'])} waves, no ownership conflicts, ~{plan['manual_estimate_hours']}h manual estimate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
