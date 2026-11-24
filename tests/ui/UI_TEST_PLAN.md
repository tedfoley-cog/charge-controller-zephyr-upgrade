# UI test plan: Migration Console

The console is served three times by `playwright.config.js`, once per migration
state, from fixtures under `tests/ui/fixtures/`:

| Port | Fixture | State |
|---|---|---|
| 4173 | `run` | mid-run: foundation merged, wave 1 in flight, one gate failing |
| 4174 | `done` | finished: every ticket done, release gate passing |
| 4175 | `empty` | day zero: baseline evidence only |

`inventory.json` and `plan.json` in the fixtures are real output of `make scan`,
`make trial` and `make plan` on the v3.2 tree. Board and gate evidence are
synthetic (`FW-` keys, example.atlassian.net).

## Journeys

1. **Triage** (`01-triage.spec.js`): overview KPIs → click a category bar →
   inventory pre-filtered → search → sort both directions → finding drawer with
   source context and fix → jump to the owning ticket. Plus: filters live in the
   URL and survive reload; reset; no-results state; CSV export contains exactly
   the filtered rows.
2. **Plan and board** (`02-plan-board.spec.js`): three waves, four parallel
   tickets, disjoint-ownership banner; ticket drawer shows review status, PR
   link, owned paths; link to its findings. Board columns mirror Jira status;
   wave filter; drawer closes on Escape and scrim click and restores focus.
3. **Release gate** (`03-release-gate.spec.js`): failing gate is visible and
   blocks sign-off even with a valid form; per-field validation and focus; the
   flash-budget input re-evaluates every board; sign-off persists across reload
   and can be revoked.
4. **Day zero** (`04-day-zero.spec.js`): every view shows the next command
   instead of a blank; no page errors; unknown route fallback; keyboard tab
   navigation; browser back.
5. **Visual** (`05-visual.spec.js`): screenshots of the overview, plan drawer,
   flash chart and the narrow-viewport board; no horizontal overflow at 820 px.

## Running

```
make ui-install     # once
make ui-test        # headless, all journeys
npx playwright test --ui
```

CI runs the suite on every push and uploads the HTML report.

## Interactive click-through (demo finale)

Run `make console` on the migration branch (real data) and walk journeys 1 to 3
in a browser while recording: overview → inventory drill-down → plan → board
(open the Jira and PR links) → evidence → sign-off.
