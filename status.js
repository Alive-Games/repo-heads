// Git state of one repo: what is checked out, how it compares with the trunk branch on origin, where its work
// was merged into the trunk, whether a submodule matches the commit its parent pins, and extra worktrees.
// No VS Code dependency, so it can be tested with plain node: `node status.js <repo-dir>...`.
const { execFile, spawn } = require("node:child_process");
const path = require("node:path");

const git = (cwd, args) =>
  new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? null : stdout.trim()),
    );
  });

// Pipes `git <args>` into `git patch-id --stable` and returns its [patchId, commit] pairs.
function patchIds(cwd, args) {
  return new Promise((resolve) => {
    const producer = spawn("git", ["-C", cwd, ...args], { stdio: ["ignore", "pipe", "ignore"] });
    const ids = spawn("git", ["-C", cwd, "patch-id", "--stable"], { stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => (producer.kill(), ids.kill()), 30000);
    let out = "";
    producer.stdout.pipe(ids.stdin);
    ids.stdin.on("error", () => {});
    ids.stdout.on("data", (d) => (out += d));
    ids.on("close", () => {
      clearTimeout(timer);
      resolve(out.split("\n").filter(Boolean).map((line) => line.split(" ")));
    });
    producer.on("error", () => resolve([]));
    ids.on("error", () => resolve([]));
  });
}

// Patch ids of the trunk's recent commits (merges diffed against their first parent), once per trunk tip.
const trunkPatches = new Map();
function trunkPatchIds(dir, trunkSha) {
  const key = `${dir}|${trunkSha}`;
  if (!trunkPatches.has(key)) {
    const log = ["log", "--first-parent", "--diff-merges=first-parent", "-p", "--max-count=300", trunkSha];
    // Newest first, so an older commit with the same patch wins.
    trunkPatches.set(key, patchIds(dir, log).then((pairs) => new Map(pairs.map(([id, commit]) => [id, commit]))));
  }
  return trunkPatches.get(key);
}

async function findMerge(dir, sha, trunkSha) {
  // Merged or fast-forwarded: the first commit on the trunk's main line that contains it.
  if ((await git(dir, ["merge-base", "--is-ancestor", sha, trunkSha])) !== null) {
    const after = await git(dir, ["rev-list", "--first-parent", "--ancestry-path", "--reverse", `${sha}..${trunkSha}`]);
    const first = after?.split("\n")[0];
    if (!first) return sha;
    return (await git(dir, ["rev-parse", `${first}^1`])) === sha ? sha : first;
  }
  // Squash-merged or rebased: a trunk commit with the same patch as everything since the branch left the trunk.
  const base = await git(dir, ["merge-base", sha, trunkSha]);
  if (!base) return null;
  const [own] = await patchIds(dir, ["diff", base, sha]);
  if (!own) return null;
  return (await trunkPatchIds(dir, trunkSha)).get(own[0]) ?? null;
}

// Where a commit's work landed on the trunk: `trunk` when that is the trunk's latest commit, otherwise the short
// hash of the trunk commit that brought it in; null when it isn't merged. Cached per commit and trunk tip.
const merges = new Map();
async function mergedInto(dir, sha, trunk) {
  if (!trunk || !sha) return null;
  const trunkSha = await git(dir, ["rev-parse", `origin/${trunk}`]);
  if (!trunkSha) return null;
  const key = `${dir}|${sha}|${trunkSha}`;
  if (!merges.has(key)) {
    merges.set(
      key,
      findMerge(dir, sha, trunkSha).then(async (at) => {
        if (!at) return null;
        const subject = await git(dir, ["log", "-1", "--format=%s", at]);
        return { sha: at, text: at === trunkSha ? trunk : at.slice(0, 8), subject };
      }),
    );
  }
  return merges.get(key);
}

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
    else if (current && line.startsWith("HEAD ")) current.sha = line.slice(5);
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
  const [merged] = await Promise.all([
    mergedInto(dir, headSha, vs.trunk),
    ...trees.map(async (w) => (w.merged = await mergedInto(dir, w.sha, vs.trunk))),
  ]);
  return {
    dir,
    branch: branch || null,
    sha: (headSha ?? "").slice(0, 8),
    dirty: Boolean(dirty),
    vs,
    merged,
    pin,
    worktrees: trees,
  };
}

/** ok: on the trunk and pinned; warn: behind, ahead, dirty or pin differs. */
function health(s) {
  if (s.vs.behind || s.vs.ahead || s.dirty || s.pin?.state === "differs" || !s.vs.trunk) return "warn";
  return "ok";
}

module.exports = { repoStatus, health, git, mergedInto };

if (require.main === module) {
  Promise.all(process.argv.slice(2).map((d) => repoStatus(path.resolve(d)))).then((all) =>
    console.log(JSON.stringify(all.map((s) => ({ ...s, health: health(s) })), null, 2)),
  );
}
