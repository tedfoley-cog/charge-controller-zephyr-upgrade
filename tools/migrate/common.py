"""Shared helpers for the migration tools."""
from __future__ import annotations

import json
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
MIGRATION = REPO / "migration"
RULES = MIGRATION / "rules" / "zephyr-3.2-to-4.3.yml"
SEVERITY_ORDER = {"breaking": 0, "deprecated": 1, "advisory": 2}


def load_rules(path: Path = RULES) -> dict:
    with open(path, encoding="utf-8") as fh:
        pack = yaml.safe_load(fh)
    ids = [r["id"] for r in pack["rules"]]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise ValueError(f"duplicate rule ids: {sorted(dupes)}")
    for rule in pack["rules"]:
        missing = {"id", "title", "category", "severity", "since", "files", "pattern", "fix", "ref", "stream"} - set(rule)
        if missing:
            raise ValueError(f"rule {rule.get('id')} is missing {sorted(missing)}")
        if rule["severity"] not in SEVERITY_ORDER:
            raise ValueError(f"rule {rule['id']}: unknown severity {rule['severity']}")
    return pack


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def boards(repo: Path = REPO) -> list[str]:
    return [line.strip() for line in (repo / "ci" / "boards.txt").read_text().splitlines() if line.strip()]


def board_name(target: str) -> str:
    return target.split("@")[0]
