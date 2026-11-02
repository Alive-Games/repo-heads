# Changelog

## 1.1.0

- Merged column: where each repo's and worktree's commit landed on the trunk (`main` for the latest commit, otherwise the trunk commit's short hash), detecting regular, squash and rebase merges.

## 1.0.0

- First public release: a table in Source Control with every repo, submodule and worktree in the workspace, showing branch, commit, ahead/behind the trunk, submodule pin and worktrees.
- Fetch All and Refresh buttons; automatic refresh on git changes, window focus and a timer.
- Settings: `repoHeads.trunkBranch`, `repoHeads.refreshSeconds`.
