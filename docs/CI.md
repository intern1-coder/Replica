# CI Pipeline

The GitHub Actions CI pipeline (`.github/workflows/ci.yml`) runs on every push and pull request to `master`. It executes two parallel jobs: the **backend** job installs dependencies, generates the Prisma client, runs a TypeScript build check, applies migrations against a throwaway Postgres 15 instance, and runs the Jest test suite; the **frontend** job installs dependencies and runs `tsc -b && vite build`, which catches both type errors and bundling failures.

## Branch workflow (how we work)

**Trunk:** `master` only. GitHub default branch, CI, and production deploy must all use `master`.

**Per change:**

1. `git checkout master && git pull origin master`
2. `git checkout -b fix/short-description` (or `feat/…`)
3. Commit, push, open **one PR → `master`**
4. Wait for CI green (backend + frontend checks)
5. Merge PR, delete the branch on GitHub
6. On the server: `git pull origin master` and deploy (see `docs/DEPLOY.md`)

**Do not:**

- Merge the same work into `master` and another long-lived branch
- Open “sync master into feature/X” PRs
- Leave merged branches on GitHub (delete after merge)
- Target PRs at anything other than `master` unless explicitly agreed

**CI runs twice per merge — that is normal:** once on the open PR, once on push to `master` after merge. That is not a duplicate pipeline bug.

**Every new PR** shows a **“After merge — run on production server”** block (from [`.github/pull_request_template.md`](../.github/pull_request_template.md)). Copy-paste those commands in MobaXterm after merging.

See `docs/LESSONS_LEARNED.md` §12–§13 for what went wrong when default branch and deploy branch diverged, and the July 2026 session log.

## Enabling Branch Protection on `master`

To require CI to pass before a PR can be merged:

1. Go to your repository on GitHub → **Settings** → **Branches**.
2. Under **Branch protection rules**, click **Add rule** and set the branch name pattern to `master`.
3. Enable **Require status checks to pass before merging**, then search for and select the `backend` and `frontend` status checks.
4. Optionally enable **Require branches to be up to date before merging** and **Do not allow bypassing the above settings**, then click **Save changes**.
