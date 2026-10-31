// "Repo Heads" view in Source Control: a table with one row per repository VS Code knows about
// (workspace repos, submodules, nested repos): what is checked out, how it compares with the trunk on origin,
// where its work was merged into the trunk, the parent pin and extra worktrees. Refreshes when VS Code's git state changes, on a timer, and on demand.
const vscode = require("vscode");
const path = require("node:path");
const { repoStatus, health, git } = require("./status");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

class RepoHeadsView {
  constructor() {
    this.statuses = [];
    this.view = null;
    this.refreshing = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "openWorktree") vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(msg.path), { forceNewWindow: true });
      if (msg.type === "reveal") vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(msg.path));
    });
    this.render();
  }

  async repoDirs() {
    const api = vscode.extensions.getExtension("vscode.git")?.exports?.getAPI(1);
    const dirs = new Set((api?.repositories ?? []).map((r) => r.rootUri.fsPath));
    // Also pick up initialized submodules VS Code did not open (beyond git.detectSubmodulesLimit).
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const top = await git(folder.uri.fsPath, ["rev-parse", "--show-toplevel"]);
      if (!top) continue;
      dirs.add(top);
      const subs = await git(top, ["submodule", "foreach", "--recursive", "--quiet", 'echo "$toplevel/$sm_path"']);
      for (const line of (subs ?? "").split("\n")) if (line) dirs.add(path.normalize(line));
    }
    // A repo VS Code still lists after its folder was deleted has no HEAD any more; drop it.
    const live = await Promise.all([...dirs].map(async (d) => ((await git(d, ["rev-parse", "HEAD"])) ? d : null)));
    return live.filter(Boolean).sort((a, b) => a.length - b.length || a.localeCompare(b));
  }

  refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const trunk = vscode.workspace.getConfiguration("repoHeads").get("trunkBranch", "main");
        this.statuses = await Promise.all((await this.repoDirs()).map((d) => repoStatus(d, trunk)));
        this.render();
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  label(s) {
    const root = this.statuses[0]?.dir;
    if (s.dir === root) return path.basename(s.dir);
    const rel = root ? path.relative(root, s.dir) : s.dir;
    return rel.startsWith("..") ? path.basename(s.dir) : rel;
  }

  rows() {
    return this.statuses
      .map((s) => {
        const ok = health(s) === "ok";
        const vsClass = s.vs.behind || s.vs.ahead || !s.vs.trunk ? "warn" : "ok";
        const pin = !s.pin ? `<span class="dim">—</span>` : s.pin.state === "matches" ? `<span class="ok">✓</span>` : `<span class="warn">${esc(s.pin.text)}</span>`;
        const branch = s.branch ? esc(s.branch) : `<span class="dim">detached</span>`;
        const merged = (m) =>
          m ? `<span class="ok" title="${esc(m.sha.slice(0, 8))} ${esc(m.subject)}">${esc(m.text)}</span>` : `<span class="dim">—</span>`;
        const trees = s.worktrees.length ? `<span class="badge">${s.worktrees.length}</span>` : `<span class="dim">—</span>`;
        const repoRow = `<tr title="${esc(s.dir)}">
          <td class="icon ${ok ? "ok" : "warn"}">${ok ? "✓" : "⚠"}</td>
          <td class="repo"><a data-reveal="${esc(s.dir)}">${esc(this.label(s))}</a></td>
          <td>${branch}${s.dirty ? ` <span class="warn" title="uncommitted changes">●</span>` : ""}</td>
          <td class="mono dim">${esc(s.sha)}</td>
          <td class="${vsClass}">${esc(s.vs.text)}</td>
          <td class="mono">${merged(s.merged)}</td>
          <td>${pin}</td>
          <td>${trees}</td>
        </tr>`;
        const treeRows = s.worktrees
          .map(
            (w) => `<tr class="sub" title="${esc(w.path)}">
          <td></td>
          <td class="repo"><span class="dim">└</span> <a data-open="${esc(w.path)}">${esc(path.basename(w.path))}</a></td>
          <td>${w.branch ? esc(w.branch) : `<span class="dim">detached</span>`}</td>
          <td class="mono dim">${esc((w.sha ?? "").slice(0, 8))}</td>
          <td class="dim">worktree</td>
          <td class="mono">${merged(w.merged)}</td>
          <td colspan="2"></td>
        </tr>`,
          )
          .join("");
        return repoRow + treeRows;
      })
      .join("");
  }

  render() {
    if (!this.view) return;
    this.view.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { padding: 4px 8px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 600; color: var(--vscode-descriptionForeground); padding: 4px 6px; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
  td { padding: 3px 6px; white-space: nowrap; border-bottom: 1px solid var(--vscode-tree-tableOddRowsBackground, transparent); }
  tr:hover td { background: var(--vscode-list-hoverBackground); }
  tr.sub td { font-size: 0.95em; }
  .icon { width: 1em; text-align: center; }
  .ok { color: var(--vscode-testing-iconPassed); }
  .warn { color: var(--vscode-list-warningForeground); }
  .dim { color: var(--vscode-descriptionForeground); }
  .mono { font-family: var(--vscode-editor-font-family); }
  .repo a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
  .repo a:hover { text-decoration: underline; }
  .badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 8px; padding: 0 6px; }
  .empty { color: var(--vscode-descriptionForeground); padding: 8px 0; }
</style></head><body>
${this.statuses.length ? `<table>
  <thead><tr><th></th><th>Repo</th><th>Branch</th><th>Commit</th><th>vs origin</th><th>Merged</th><th>Pin</th><th>Worktrees</th></tr></thead>
  <tbody>${this.rows()}</tbody>
</table>` : `<div class="empty">Loading…</div>`}
<script>
  const vscode = acquireVsCodeApi();
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    if (a.dataset.open) vscode.postMessage({ type: "openWorktree", path: a.dataset.open });
    if (a.dataset.reveal) vscode.postMessage({ type: "reveal", path: a.dataset.reveal });
  });
</script></body></html>`;
  }
}

function activate(context) {
  const view = new RepoHeadsView();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("repoHeadsTable", view),
    vscode.commands.registerCommand("repoHeads.refresh", () => view.refresh()),
    vscode.commands.registerCommand("repoHeads.fetchAll", async () => {
      await vscode.window.withProgress(
        { location: { viewId: "repoHeadsTable" }, title: "Fetching" },
        async () => Promise.all(view.statuses.map((s) => git(s.dir, ["fetch", "--quiet", "origin"]))),
      );
      await view.refresh();
    }),
  );

  // Refresh when VS Code's own git state changes (checkout, commit, fetch), debounced.
  let timer = null;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => view.refresh(), 750);
  };
  const api = vscode.extensions.getExtension("vscode.git")?.exports?.getAPI(1);
  if (api) {
    const watch = (repo) => context.subscriptions.push(repo.state.onDidChange(soon));
    api.repositories.forEach(watch);
    context.subscriptions.push(api.onDidOpenRepository((repo) => { watch(repo); soon(); }), api.onDidCloseRepository(soon));
  }
  const seconds = vscode.workspace.getConfiguration("repoHeads").get("refreshSeconds", 30);
  const interval = setInterval(() => view.refresh(), Math.max(5, seconds) * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(interval) }, vscode.window.onDidChangeWindowState((w) => w.focused && soon()));

  view.refresh();
}

module.exports = { activate, deactivate() {}, RepoHeadsView };
