---
name: os-upgrade-ticket
description: Work one ticket of the Zephyr v3.2 to v4.3 upgrade plan and open a tested pull request for it. Use when given a plan ticket id (foundation, can, mppt-lowpower, pwm, numerics) or its Jira key.
---

# One upgrade ticket, one tested pull request

## Start

1. `git fetch origin && git checkout -b devin/<JIRA-KEY>-<ticket-id> origin/upgrade/zephyr-4.3`
2. Read your ticket in `migration/plan.json` (`tickets[].id`): `owns`,
   `acceptance`, `gate`, `findings`. Look the finding ids up in
   `migration/inventory.json`; each has file, line, fix and a reference link.
3. Move the Jira ticket to In Progress (Atlassian MCP:
   `getTransitionsForJiraIssue`, `transitionJiraIssue`).
4. `scripts/ws.sh target setup` if `~/zephyr-ws/v4.3` does not exist.

## Work

- Change only files matched by your ticket's `owns` globs. Other tickets run in
  parallel on the rest. If you need a change outside them, stop and tell the
  orchestrator.
- **Tests first for behaviour changes.** If you touch `app/src/`, add unit
  tests under `tests/src/` that pin the current behaviour (register them in
  the test runner the same way existing suites are), see them pass, then
  change the code. The gate fails a change under `app/src/` that adds no tests.
- Use the Zephyr migration guides and release notes linked from each finding;
  the public Zephyr tree in `~/zephyr-ws/v4.3/zephyr` has reference boards for
  the same SoCs under `boards/st/`.
- Hardware model v2 for a board: move `boards/arm/<board>` to
  `boards/<vendor>/<board>`, add `board.yml` (SoC, revisions), rename
  `Kconfig.board` → `Kconfig.<board>` selecting the SoC, drop `CONFIG_SOC_*`
  from the defconfig, drop `config BOARD` from `Kconfig.defconfig`, replace
  `revision.cmake` by `board.yml` revisions.
- Build loop: `make test` and `make firmware BOARD=<board>`; logs are in
  `build/logs/`.

## Prove

```
<your ticket's gate command from plan.json>
python3 tools/migrate/scan.py --no-write     # your stream's findings should be gone
```

The gate writes `migration/evidence/<ticket-id>.json`. Commit it. It must say
`"verdict": "pass"`. Never edit evidence by hand, weaken a check, skip or
delete a test, or change the flash budget.

## Pull request

- Base: `upgrade/zephyr-4.3`. Title: `<JIRA-KEY>: <ticket title>`.
- Description: what changed and why, findings closed (rule ids and counts),
  gate table copied from the evidence file (tests before/after, flash and SRAM
  per board vs baseline), regression tests added.
- Wait for CI. Fix failures.
- Devin Review reviews the pull request. Read every finding: fix it, or reply
  on the thread with the reason it does not apply. Re-run the gate after fixes.
- Comment on the Jira ticket with the PR link and gate verdict; move it to
  In Review. Do not merge.

## Report

PR URL, gate verdict, unit test count (before → after), boards built with
flash delta, Devin Review findings (raised / resolved).
