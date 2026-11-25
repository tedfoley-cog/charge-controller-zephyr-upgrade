#!/usr/bin/env python3
"""Rule-driven deprecation scanner.

Walks the repository, applies every rule in the rule pack and writes
migration/inventory.json. Build diagnostics harvested by trial.py are kept
when the file is rewritten.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

from common import MIGRATION, REPO, SEVERITY_ORDER, glob_match, load_rules, read_json, write_json

SKIP_DIRS = {".git", "build", "node_modules", "console", "tools", "migration", "docs", "test-results"}


def candidate_files(repo: Path, globs: list[str], exclude_globs: list[str] | None = None) -> list[Path]:
    found: set[Path] = set()
    for pattern in globs:
        if pattern.endswith('**'):
            pattern += '/*'
        for path in repo.glob(pattern):
            rel = path.relative_to(repo)
            if not path.is_file() or set(rel.parts[:-1]) & SKIP_DIRS:
                continue
            if any(glob_match(rel.as_posix(), g) for g in exclude_globs or ()):
                continue
            found.add(path)
    return sorted(found)


def scan(repo: Path = REPO, pack: dict | None = None) -> list[dict]:
    pack = pack or load_rules()
    findings: list[dict] = []
    for rule in pack["rules"]:
        regex = re.compile(rule["pattern"])
        exclude = re.compile(rule["exclude"]) if rule.get("exclude") else None
        for path in candidate_files(repo, rule["files"], rule.get("exclude_files")):
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except UnicodeDecodeError:
                continue
            for number, line in enumerate(lines, start=1):
                if exclude and exclude.search(line):
                    continue
                if not regex.search(line):
                    continue
                rel = path.relative_to(repo).as_posix()
                findings.append(
                    {
                        "id": f"{rule['id']}:{rel}:{number}",
                        "rule": rule["id"],
                        "source": "static",
                        "title": rule["title"],
                        "category": rule["category"],
                        "severity": rule["severity"],
                        "since": rule["since"],
                        "removed": rule.get("removed"),
                        "stream": rule["stream"],
                        "file": rel,
                        "line": number,
                        "snippet": line.strip()[:200],
                        "context": [
                            {"line": n, "text": lines[n - 1][:200]}
                            for n in range(max(1, number - 2), min(len(lines), number + 2) + 1)
                        ],
                        "fix": rule["fix"],
                        "ref": rule["ref"],
                    }
                )
    findings.sort(key=lambda f: (SEVERITY_ORDER[f["severity"]], f["rule"], f["file"], f["line"]))
    return findings


def summarize(findings: list[dict]) -> dict:
    return {
        "total": len(findings),
        "by_severity": dict(Counter(f["severity"] for f in findings)),
        "by_category": dict(Counter(f["category"] for f in findings)),
        "by_stream": dict(Counter(f["stream"] for f in findings)),
        "by_source": dict(Counter(f["source"] for f in findings)),
        "files": len({f["file"] for f in findings}),
    }


def build_inventory(repo: Path = REPO, keep_build: bool = True) -> dict:
    pack = load_rules()
    findings = scan(repo, pack)
    if keep_build:
        previous = read_json(MIGRATION / "inventory.json", {}) or {}
        findings += [f for f in previous.get("findings", []) if f.get("source") == "build"]
    return {
        "from": pack["from"],
        "to": pack["to"],
        "rules": len(pack["rules"]),
        "summary": summarize(findings),
        "findings": findings,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="exit 1 if any breaking finding remains")
    parser.add_argument("--stream", help="only count findings of this work stream (with --check)")
    parser.add_argument("--no-write", action="store_true")
    args = parser.parse_args(argv)

    inventory = build_inventory()
    if not args.no_write:
        write_json(MIGRATION / "inventory.json", inventory)
    summary = inventory["summary"]
    print(f"Zephyr {inventory['from']} -> {inventory['to']}: {summary['total']} findings in {summary['files']} files")
    for severity in SEVERITY_ORDER:
        print(f"  {severity:<10} {summary['by_severity'].get(severity, 0)}")
    per_rule = Counter(f["rule"] for f in inventory["findings"])
    for rule, count in sorted(per_rule.items()):
        print(f"  {rule:<14} {count}")
    if args.check:
        remaining = [
            f for f in inventory["findings"]
            if f["severity"] == "breaking" and f["source"] == "static" and (not args.stream or f["stream"] == args.stream)
        ]
        if remaining:
            print(f"FAIL: {len(remaining)} breaking findings remain", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
