---
name: console-ui-test
description: Click-test the Migration Console in a real browser against the live migration data and record it. Use as the last step of an OS upgrade run, or when asked to test or demo the console UI.
---

# Console UI test (demo finale)

1. On the integration branch: `npm ci`, `npx playwright install chromium`,
   `npx playwright test` (headless journeys must pass first).
2. `make console` and open http://localhost:4173 in the browser. This serves
   the real `migration/` data of the branch, not fixtures.
3. Record the screen and walk these, checking each expectation against
   `migration/*.json`:
   - **Overview**: stepper state, findings and breaking counts equal
     `inventory.summary`, boards on v4.3 count, flash table.
   - **Inventory**: click a category bar on the overview, confirm the filter;
     search `can`; sort by Location; open a finding and check file, line, fix;
     follow the ticket link.
   - **Plan**: three waves, disjoint-ownership banner, open a wave-1 ticket,
     check Jira key, PR number and Devin Review counts.
   - **Board**: column of every ticket equals its Jira status; open the epic
     link and one PR link in new tabs and confirm they resolve.
   - **Evidence**: every gate card shows pass with the same test count as its
     evidence file; set the flash budget to 1 and confirm boards turn red and
     sign-off is blocked; set it back to 8, fill the form, sign off, reload,
     confirm it persisted; revoke.
4. Report pass/fail per view with screenshots; attach the recording. Any
   mismatch between UI and data is a bug: fix it on a branch with a Playwright
   test, do not paper over it.
