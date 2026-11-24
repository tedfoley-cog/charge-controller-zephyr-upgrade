# Embedded OS upgrade: Zephyr v3.2 -> v4.3
PY ?= python3
WS := scripts/ws.sh

.PHONY: help setup baseline scan trial plan gate gate-all test firmware tools-test console ui-test ui-install lint style

help:
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

setup: ## Create the baseline and target Zephyr workspaces (one-off, ~2 GB)
	$(WS) baseline setup
	$(WS) target setup

baseline: ## Record baseline evidence on the v3.2 tree (tests, flash, SRAM)
	$(PY) tools/migrate/gate.py --capture-baseline

scan: ## Static deprecation scan -> migration/inventory.json
	$(PY) tools/migrate/scan.py

trial: ## Build this tree against Zephyr v4.3 and harvest the diagnostics
	$(PY) tools/migrate/trial.py

plan: ## Group findings into tickets -> migration/plan.json
	$(PY) tools/migrate/plan.py

test: ## Firmware unit tests on the OS version this tree targets
	$(WS) auto test

firmware: ## Build one board: make firmware BOARD=mppt_2420_lc
	$(WS) auto build $(BOARD)

gate: ## No-regression gate for the current tree
	$(PY) tools/migrate/gate.py $(GATE_ARGS)

gate-all: ## Integration gate: every board must be migrated and inside budget
	$(PY) tools/migrate/gate.py --require-all-boards

tools-test: ## Unit tests for the migration tooling
	$(PY) -m pytest -q tools/tests

console: ## Serve the Migration Console on http://localhost:4173
	node console/server.mjs

ui-install:
	npm ci && npx playwright install --with-deps chromium

ui-test: ## Playwright journeys for the Migration Console
	npx playwright test

lint: ## Lint the console and the tools
	npx eslint console tests/ui
	$(PY) -m pyflakes tools

style: ## clang-format check of changed firmware lines
	bash scripts/check-style.sh
