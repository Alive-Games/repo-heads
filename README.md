# Repo Heads

**See every repo, submodule and worktree in your workspace at a glance.**

VS Code's Source Control view shows a submodule as a bare commit hash, and it does not tell you whether that commit is up to date, whether it matches what the parent repo pins, or which worktrees you have open. Repo Heads puts all of that in one table.

![Repo Heads table](https://raw.githubusercontent.com/Alive-Games/repo-heads/main/images/screenshot.png)

## What it shows

One row per repository: the repos in your workspace, every initialized submodule (recursively) and nested repos VS Code detects.

| Column | Meaning |
| --- | --- |
| ✓ / ⚠ | ✓ when the repo is on the trunk, clean and (for a submodule) at the commit its parent pins; ⚠ when anything differs |
| Repo | Path relative to the workspace root. Click to reveal it in the Explorer |
| Branch | The checked-out branch, or `detached` (normal for submodules). ● means uncommitted changes |
| Commit | The short commit hash |
| vs origin | `= main`, `N behind main`, `N ahead of main`, or both, as of the last fetch |
| Pin | For submodules: ✓ when the checkout matches the commit the parent repo records, or the commit the parent pins when it does not |
| Worktrees | How many extra worktrees the repo has. Each one is listed below it; click to open it in a new window |

## Where to find it

In the **Source Control** view, in the **Repo Heads** section. The title bar has two buttons:

- **Fetch All** (☁) runs `git fetch` in every repo, so "vs origin" is current.
- **Refresh** (↻).

The table also refreshes on its own when VS Code sees a git change (checkout, commit, fetch), when the window gets focus, and on a timer.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `repoHeads.trunkBranch` | `main` | Branch on origin to compare each repo with. Falls back to origin's default branch when a repo has no such branch |
| `repoHeads.refreshSeconds` | `30` | How often the table refreshes on its own, in seconds (minimum 5) |

## Tips

- VS Code only opens a limited number of submodules by default. Repo Heads lists all of them anyway, but to work with them in Source Control raise `git.detectSubmodulesLimit`.
- Remote, WSL and dev containers are supported: the extension runs where your repos are.

## Requirements

Git on the `PATH`, and VS Code 1.90 or later.

## License

[MIT](LICENSE). Made by [Alive Games](https://alivegames.io).
