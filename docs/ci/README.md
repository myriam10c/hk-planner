# Deploy canary — CI workflow

`smoke-workflow.yml` is a single GitHub Actions workflow that does two things:

1. **PRs / non-main pushes / manual triggers** — runs the Playwright smoke suite against any URL (defaults to prod).
2. **Push to `main`** — full **deploy canary**: waits for Netlify to finish deploying the new commit, runs the smoke suite, and **auto-rolls back to the previous successful deploy** if any test fails.

This catches the bug class that bit us on 2026-04-30: an unrelated agent force-pushed a React rewrite to `main`, Netlify auto-deployed it, the new app didn't ship `styles.css` at the expected path, and prod served a white page for 12 hours before anyone noticed.

## Activation

The workflow file lives in `docs/ci/` because the PAT used to seed this repo lacks the `workflow` scope. To enable it:

### Option A — copy via GitHub web UI (1 minute)
1. Open https://github.com/myriam10c/hk-planner
2. Press `.` (or visit `/edit/main/docs/ci/smoke-workflow.yml`)
3. Open `docs/ci/smoke-workflow.yml`, "Copy raw file" contents
4. Create a new file at `.github/workflows/smoke.yml`, paste, commit
5. Delete `docs/ci/smoke-workflow.yml` (no longer needed)

### Option B — generate a properly-scoped PAT
1. https://github.com/settings/tokens → **Generate new token (classic)**
2. Scopes: `repo` + `workflow`
3. Replace the saved token in your local git credential store, then:
   ```bash
   git mv docs/ci/smoke-workflow.yml .github/workflows/smoke.yml
   git commit -m "Activate deploy canary CI"
   git push
   ```

## Required GitHub secret

Once the workflow is active, it needs the Netlify token to wait for deploys and issue rollbacks:

1. https://github.com/myriam10c/hk-planner/settings/secrets/actions
2. **New repository secret** → name `NETLIFY_AUTH_TOKEN`, value = same token as `~/.netlify/token.env`
3. Save

Without this secret, the canary step skips the wait/rollback portion silently — the smoke step still runs against the URL, just without the deploy-state awareness.

## What runs when

| Event | Wait for deploy | Run smoke | Rollback on fail |
|---|---|---|---|
| `push` to `main` | ✅ (~10 min timeout) | ✅ vs prod URL | ✅ |
| `pull_request` | ❌ | ✅ vs prod URL (configurable) | ❌ |
| `workflow_dispatch` (manual) | ❌ | ✅ vs `target_url` input | ❌ |
| Push to other branches | — | — | — |

Smoke failures upload the Playwright report as a workflow artifact (`playwright-report`), retained 14 days.

## Local equivalent

The repo also ships `canary.sh` at the root — same logic, runs from your machine. Useful when you want to verify a deploy without waiting for CI:

```bash
./canary.sh             # smoke prod, rollback if failed
./canary.sh --dry-run   # smoke only, never rollback
```

Reads `NETLIFY_AUTH_TOKEN` from env or `~/.netlify/token.env`.
