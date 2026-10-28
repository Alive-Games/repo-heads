// Git state of one repo: what is checked out, how it compares with the trunk branch on origin, whether a submodule
// matches the commit its parent pins, and extra worktrees. No VS Code dependency, so it can be tested
// with plain node: `node status.js <repo-dir>...`.
const { execFile } = require("node:child_process");
const path = require("node:path");

const git = (cwd, args) =>
  new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? null : stdout.trim()),
    );
  });

async function compareWithTrunk(dir, preferred) {
  // Compare with the preferred trunk when origin has it; otherwise with origin's default branch.
  let trunk = preferred;
  if ((await git(dir, ["rev-parse", "-q", "--verify", `origin/${trunk}`])) === null) {
    const head = await git(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    if (!head) return { trunk: null, ahead: 0, behind: 0, text: "no origin" };
    trunk = head.replace(/^origin\//, "");
  }
  const counts = await git(dir, ["rev-list", "--left-right", "--count", `origin/${trunk}...HEAD`]);
  const [behind, ahead] = (counts ?? "0 0").split(/\s+/).map(Number);
  const text =
    !behind && !ahead ? `= ${trunk}`
    : !ahead ? `${behind} behind ${trunk}`
    : !behind ? `${ahead} ahead of ${trunk}`
    : `${ahead} ahead, ${behind} behind ${trunk}`;
  return { trunk, ahead, behind, text };
}

async function parentPin(dir, headSha) {
  const parent = await git(dir, ["rev-parse", "--show-superproject-working-tree"]);
  if (!parent) return null;
  const rel = path.relative(parent, dir).split(path.sep).join("/");
  const entry = await git(parent, ["ls-tree", "HEAD", rel]);
  const pinned = entry ? entry.split(/\s+/)[2] : null;
  if (!pinned) return { state: "unpinned", text: "not pinned by parent" };
  if (pinned === headSha) return { state: "matches", text: "matches parent pin" };
  return { state: "differs", text: `parent pins ${pinned.slice(0, 8)}` };
}

async function worktrees(dir) {
  const out = (await git(dir, ["worktree", "list", "--porcelain"])) ?? "";
  const trees = [];
  let current = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) trees.push((current = { path: line.slice(9), branch: null, sha: null }));
    else if (current && line.startsWith("HEAD ")) current.sha = line.slice(5, 13);
    else if (current && line.startsWith("branch ")) current.branch = line.slice(7).replace("refs/heads/", "");
  }
  return trees.slice(1); // the first entry is the main working tree
}

async function repoStatus(dir, trunk = "main") {
  const [branch, headSha, dirty] = await Promise.all([
    git(dir, ["branch", "--show-current"]),
    git(dir, ["rev-parse", "HEAD"]),
    git(dir, ["status", "--porcelain", "--ignore-submodules=all"]),
  ]);
  const [vs, pin, trees] = await Promise.all([compareWithTrunk(dir, trunk), parentPin(dir, headSha), worktrees(dir)]);
  return {
    dir,
    branch: branch || null,
    sha: (headSha ?? "").slice(0, 8),
    dirty: Boolean(dirty),
    vs,
    pin,
    worktrees: trees,
  };
}

/** ok: on the trunk and pinned; warn: behind, ahead, dirty or pin differs. */
function health(s) {
  if (s.vs.behind || s.vs.ahead || s.dirty || s.pin?.state === "differs" || !s.vs.trunk) return "warn";
  return "ok";
}

module.exports = { repoStatus, health, git };

if (require.main === module) {
  Promise.all(process.argv.slice(2).map((d) => repoStatus(path.resolve(d)))).then((all) =>
    console.log(JSON.stringify(all.map((s) => ({ ...s, health: health(s) })), null, 2)),
  );
}
