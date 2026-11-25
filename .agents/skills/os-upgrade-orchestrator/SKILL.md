---
name: os-upgrade-orchestrator
description: Run the Zephyr v3.2 to v4.3 upgrade of this firmware end to end - baseline, deprecation inventory, plan, Jira board, foundation PR, parallel ticket sessions, integration PR. Use when asked to upgrade the OS / RTOS version, migrate to Zephyr 4.3, or "run the migration".
---

# OS upgrade orchestrator

You coordinate. Child sessions do the ticket work. The repository's default
branch stays on Zephyr v3.2 until a human merges the final pull request; never
push to it. Find it with `git symbolic-ref --short refs/remotes/origin/HEAD`
(below: `<default>`).

## 1. Baseline and inventory

```
make setup          # both Zephyr workspaces (skip if ~/zephyr-ws/v3.2 and v4.3 exist)
git checkout -b upgrade/zephyr-4.3 origin/<default>
make baseline       # only if migration/evidence/baseline.json is missing
make scan           # static rules
make trial          # build the v3.2 tree against v4.3, harvest diagnostics
make plan           # must print "no ownership conflicts"
```

Commit `migration/inventory.json` and `migration/plan.json` and push
`upgrade/zephyr-4.3`. This is the integration branch every ticket PR targets.

## 2. Ticket board (Jira)

Use the Atlassian MCP (`getAccessibleAtlassianResources`, `createJiraIssue`,
`getTransitionsForJiraIssue`, `transitionJiraIssue`, `addCommentToJiraIssue`).
Project key: `MBA` unless the user names another.

1. Create one Epic from `plan.epic.summary`. Description: inventory totals by
   severity, the wave table, link to the integration branch.
2. Create one Task per `plan.tickets[]`: summary = `title`, description =
   `description` (already Markdown), parent = the epic, labels
   `zephyr-4.3`, `wave-<n>`.
3. Write `migration/board.json` and commit it to the integration branch:

```json
{
  "site": "https://<site>.atlassian.net",
  "project": "MBA",
  "epic": { "key": "MBA-1", "url": "https://<site>.atlassian.net/browse/MBA-1" },
  "tickets": {
    "foundation": { "key": "MBA-2", "url": "...", "status": "To Do" }
  }
}
```

`status` is one of `To Do`, `In Progress`, `In Review`, `Done`. Later you add
`pr` (`number`, `url`, `state`), `review` (`status`, `findings`, `resolved`)
and `session` (child session URL) per ticket. Only the orchestrator edits
`board.json`; children never touch it, so their PRs cannot conflict on it.

## 3. Wave 0: foundation

Start one child session with the prompt below (ticket id `foundation`). Wait
for it. Require: PR open against `upgrade/zephyr-4.3`, CI green, Devin Review
findings resolved or answered. Then merge that PR into `upgrade/zephyr-4.3`
(this is the integration branch, not the default branch) and move the Jira ticket to Done.

## 4. Wave 1: parallel sessions

Start one child session per wave-1 ticket at the same time, same prompt. The
plan guarantees disjoint file ownership. While they run, keep `board.json` and
Jira in step with reality. For each finished child: check CI and review as in
wave 0, merge its PR into `upgrade/zephyr-4.3`, ticket to Done. If a child is
stuck on something another ticket owns, message both children; do not fix
ticket work yourself.

Child prompt:

```
Repo: <owner>/<repo>. Use the os-upgrade-ticket skill for ticket `<id>`
(Jira <KEY>, <jira url>). Base branch: upgrade/zephyr-4.3. Open one pull
request against that branch, get CI green and resolve Devin Review findings.
Report back: PR URL, gate verdict, unit test count, review findings/resolved.
```

## 5. Wave 2: integration

On `upgrade/zephyr-4.3` after all merges:

```
make scan && python3 tools/migrate/scan.py --check   # no breaking findings left
make plan
python3 tools/migrate/gate.py --ticket integration --require-all-boards
```

Fix only integration fallout (e.g. two tickets' tests registering in the same
runner). Commit the refreshed inventory, plan, `migration/evidence/integration.json`
and final `board.json`. Open the pull request `upgrade/zephyr-4.3` → `<default>`
with the before/after table (tests, flash per board, findings) and links to
the epic and every ticket PR. Wait for CI and Devin Review, resolve findings.
**Do not merge it.** Move the integration ticket to In Review.

## 6. Hand over

Run the `console-ui-test` skill, then report: epic link, ticket → PR table,
gate verdict, test count before/after, the final PR link.

## Rules

- Never weaken a gate, delete a test or raise the flash budget to get green.
- A ticket is Done only when its PR is merged into the integration branch.
- Every claim in the report comes from `migration/evidence/*.json`, CI or the PR.
