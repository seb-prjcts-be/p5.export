# Protecting the `main` branch

GitHub warns when the default branch has no protection: anyone with write
access can force-push over history or delete the branch, and changes can land
without review or a green build. Branch protection is a **repository setting**
— it lives in GitHub's settings, not in a file in this repo — so it has to be
enabled once in the GitHub UI (or via the API). This document records the
settings to apply and why.

The [CI workflow](../.github/workflows/ci.yml) in this PR exists so there is a
status check (`validate`) to require. Enable the rule below once CI has run at
least once on `main` so the check name is selectable.

## Recommended settings

Use either a **Repository Ruleset** (newer, recommended) or a **classic Branch
protection rule**. Both achieve the same thing; pick one.

### Option A — Repository Ruleset (recommended)

**Settings → Rules → Rulesets → New branch ruleset**

- Ruleset name: `protect-main`
- Enforcement status: **Active**
- Target branches: **Include default branch** (`main`)
- Rules:
  - ☑ **Restrict deletions** — block deleting the branch
  - ☑ **Block force pushes** — history can only move forward
  - ☑ **Require a pull request before merging**
    - Required approvals: `1` (set to `0` for a solo repo if you don't want to
      block yourself, but keep the PR requirement)
  - ☑ **Require status checks to pass**
    - Add check: `validate`
    - ☑ Require branches to be up to date before merging

### Option B — Classic branch protection

**Settings → Branches → Add branch protection rule**

- Branch name pattern: `main`
- ☑ Require a pull request before merging
- ☑ Require status checks to pass before merging → select `validate`
- ☑ Require branches to be up to date before merging
- ☑ Do not allow bypassing the above settings *(optional)*
- Leave "Allow force pushes" and "Allow deletions" **unchecked** (the default),
  which is what blocks force-push and deletion.

## Verifying

After enabling, confirm from a terminal that force-push and deletion are
rejected:

```sh
git push --force origin main        # expected: rejected (protected branch)
git push origin --delete main       # expected: rejected (protected branch)
```

Both should fail with a "protected branch" error. A normal PR merge with a
green `validate` check should still succeed.
