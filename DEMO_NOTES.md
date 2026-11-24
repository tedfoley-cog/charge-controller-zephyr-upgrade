# Demo notes

- **Setup (before the call):** the Devin environment has both Zephyr workspaces and the ARM toolchain prebuilt (`make setup`), the Atlassian MCP connected, and Devin Review enabled on this repo. `main` is day zero: firmware on Zephyr v3.2, no inventory, no plan.
- **Prompt:** "Use the os-upgrade-orchestrator skill to upgrade this firmware to Zephyr v4.3. Jira project MBA." One sentence starts everything.
- **Baseline + inventory (first minutes):** Devin runs the 95 unit tests and six board builds on v3.2, then scans with the rule pack and builds the old tree against v4.3. Show `migration/inventory.json` in the console: about 110 findings, each with file, line, fix and a link to the Zephyr migration guide.
- **Plan + board:** `make plan` groups findings into six tickets in three waves and proves the parallel ones own disjoint files. Devin creates the Jira epic and tasks; open the board in Jira.
- **Parallel sessions:** after the foundation PR, four child sessions run at once (CAN boards, MPPT boards without CAN, PWM board, control maths), each opening its own PR against `upgrade/zephyr-4.3`. Show the session list and the PRs filling in.
- **No regressions:** on any PR show CI: unit tests on `native_sim`, board builds, and the gate table (tests not removed, tests added for changed code, flash within +8 %). Then show Devin Review's findings on the same PR and Devin's replies or fixes.
- **Release PR:** one pull request `upgrade/zephyr-4.3` → `main` with the before/after table. It is left for a human to merge.
- **Finale, UI testing:** Devin runs the `console-ui-test` skill: headless Playwright journeys, then a recorded click-through of the Migration Console on the live data (overview → inventory drill-down → plan → board with Jira/PR links → evidence → sign-off form blocked and then accepted).
