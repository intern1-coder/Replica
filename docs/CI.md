# CI Pipeline

The GitHub Actions CI pipeline (`.github/workflows/ci.yml`) runs on every push and pull request to `master`. It executes two parallel jobs: the **backend** job installs dependencies, generates the Prisma client, runs a TypeScript build check, applies migrations against a throwaway Postgres 15 instance, and runs the Jest test suite; the **frontend** job installs dependencies and runs `tsc -b && vite build`, which catches both type errors and bundling failures.

## Enabling Branch Protection on `master`

To require CI to pass before a PR can be merged:

1. Go to your repository on GitHub → **Settings** → **Branches**.
2. Under **Branch protection rules**, click **Add rule** and set the branch name pattern to `master`.
3. Enable **Require status checks to pass before merging**, then search for and select the `backend` and `frontend` status checks.
4. Optionally enable **Require branches to be up to date before merging** and **Do not allow bypassing the above settings**, then click **Save changes**.
