# Implementation plan

Written before any scaffold code. This repo is the **day-zero** state of an
embedded OS upgrade: the firmware still targets Zephyr v3.2. The migration to
v4.3 is not pre-built; it is performed live by Devin sessions.

## Scenario

A product team maintains solar charge-controller firmware (C/C++ on Zephyr
RTOS, STM32 targets, CAN and serial telemetry). The platform group has moved
the supported OS baseline from **Zephyr v3.2** to **Zephyr v4.3 LTS-track**.
Three years of OS changes sit between the two: renamed Kconfig symbols, the
hardware model v2 board layout, the CAN / ISO-TP API rework, `native_posix`
replaced by `native_sim`, stricter compiler warnings. Today this is weeks of
manual "build, read error, grep, fix, repeat".

Source: the public [LibreSolar charge-controller-firmware](https://github.com/LibreSolar/charge-controller-firmware)
(Apache-2.0), pinned at the last commit that targets Zephyr v3.2.

## Customer asks → where each is shown

| Ask | Where it lives |
|---|---|
| Baseline analysis | `make baseline` → `migration/evidence/baseline.json` (unit tests, per-board flash/RAM) |
| Find deprecated API usage | `make scan` (rule pack `migration/rules/`) + `make trial` (build the v3.2 tree against v4.3, harvest diagnostics) → `migration/inventory.json` |
| Migration plan + ticket board | `make plan` → `migration/plan.json`; Jira epic + tickets created through the Atlassian MCP; keys recorded in `migration/board.json` |
| Parallel Devins, each a tested PR | `.agents/skills/os-upgrade-orchestrator` (foundation ticket, then one child session per parallel ticket) and `.agents/skills/os-upgrade-ticket` |
| Existing CI + test suites | `.github/workflows/ci.yml`: firmware unit tests, board builds, tool tests, UI tests on every push |
| Added regression tests | Ticket skill requires characterization tests for touched behaviour; `make gate` fails if the unit-test count drops or a ticket PR adds none |
| Devin Review adversarial pass | Every PR is reviewed by Devin Review; the ticket skill requires findings to be resolved or answered before the Jira ticket moves to "In Review" |
| Visual proof | Migration Console (`console/`), Playwright suite in `tests/ui/`, and a recorded click-through as the demo finale |

## Day-zero contents

1. **Firmware** (unchanged upstream sources): `app/`, `boards/`, `dts/`, `tests/`, `west.yml` pinned to v3.2.
2. **Workspace tooling**: `scripts/ws.sh` creates one west workspace per OS version under `~/zephyr-ws/` and mirrors the working tree into it, so the same checkout can be built against either version.
3. **Migration tooling** (`tools/migrate/`, Python, tested):
   - `scan.py`: rule-driven deprecation scanner (Kconfig, devicetree, board model, C/C++ API, build system).
   - `trial.py`: runs the target-OS build and classifies compiler / Kconfig / devicetree diagnostics.
   - `plan.py`: groups findings into work streams with disjoint file ownership, waves and gates.
   - `gate.py`: no-regression gate (test count, pass rate, flash budget per board, warning ratchet).
4. **Migration Console** (`console/`): dependency-free web UI over `migration/*.json` with Overview, Inventory, Plan, Board and Evidence views.
5. **Agent skills** (`.agents/skills/`): orchestrator, per-ticket worker, UI test finale.
6. **CI**: firmware (tests + boards), tools (pytest), console (lint + Playwright).
7. **Docs**: README with flowchart, `docs/flowchart.html|png`, `DEMO_NOTES.md`, `tests/ui/UI_TEST_PLAN.md`.

## What is deliberately not done on `main`

- No source file is ported to v4.3.
- No inventory, plan or Jira keys are committed; they are produced by the run.
- No regression tests beyond the upstream suite.

## Migration shape the tooling steers toward

| Wave | Ticket | Owns | Gate |
|---|---|---|---|
| 0 | Foundation | `west.yml`, `zephyr/module.yml`, CMake roots, Kconfig renames, `tests/` harness, reference board | 95 unit tests on `native_sim`, reference board builds |
| 1 | CAN boards | CAN-enabled boards, `app/src/ext/can.cpp` | boards build, CAN frame/filter regression tests |
| 1 | Low-power MPPT boards | STM32L0 MPPT boards | boards build inside flash budget |
| 1 | PWM boards | PWM controller boards | boards build inside flash budget |
| 1 | Numerics | float/double promotion in control code | zero new warnings, characterization tests unchanged |
| 2 | Integration | merge of wave branches | all boards, all tests, full gate |

Wave 1 tickets touch disjoint paths, so they run as parallel sessions and
their PRs do not conflict.

## Verification before push

Fresh clone → `make setup` → `make baseline` → `make scan` → `make plan` →
`make console` → Playwright headless → interactive browser pass → CI green.
