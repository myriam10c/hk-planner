# Smoke test CI workflow

This file is the GitHub Actions workflow for running Playwright smoke tests on every push and PR.
It lives in `docs/ci/` because pushing to `.github/workflows/` requires a PAT with `workflow` scope.

## Activation

Once via GitHub web UI:
1. `mkdir -p .github/workflows`
2. Copy contents of `smoke-workflow.yml` to `.github/workflows/smoke.yml`
3. Commit + push (now lives in the right place)

Or generate a new PAT at https://github.com/settings/tokens with `repo` + `workflow` scopes and re-push.
