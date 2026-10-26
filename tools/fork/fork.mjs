#!/usr/bin/env node
// This fork's overlay on chhoumann/t3-pstack. The fork's tree is always
// upstream at `upstreamSha` plus the overlay: the files `own` lists, upstream's
// repository slug rewritten to the fork's outside `keepUpstreamSlug`, and the
// patches in tools/fork/patches applied in name order. A sync rebuilds the tree
// from the new upstream commit, so a conflict never needs a merge.
//
//   node tools/fork/fork.mjs apply [dir]       apply the overlay to a working tree
//   node tools/fork/fork.mjs verify            HEAD must equal its upstreamSha rebuilt
//   node tools/fork/fork.mjs sync <ref>        print a commit on HEAD rebuilt from <ref>,
//                                              or nothing when HEAD already carries it
//                              [--repair]      skip verify, for patches redone for <ref>
//
// Run from anywhere inside the repository. verify and sync read committed
// files only, so commit before running them.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG = "tools/fork/fork.json";
const PATCHES = "tools/fork/patches";

// autocrlf off, so a Windows checkout rebuilds the same bytes as Linux CI.
const GIT = ["-c", "core.autocrlf=false"];
const git = (cwd, ...args) => execFileSync("git", [...GIT, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitOk = (cwd, ...args) => spawnSync("git", [...GIT, ...args], { cwd, stdio: "ignore" }).status === 0;

const under = (path, prefixes) => prefixes.some((p) => path === p || path.startsWith(`${p}/`));

export function apply(dir) {
  const config = JSON.parse(readFileSync(join(dir, CONFIG), "utf8"));
  const kept = [...config.own, ...config.keepUpstreamSlug];
  // The plain slug, and the form a test's regex literal escapes.
  const escaped = (slug) => slug.replace("/", "\\/");
  const slugs = [
    [config.upstream, config.fork],
    [escaped(config.upstream), escaped(config.fork)],
  ];
  for (const path of git(dir, "ls-files", "-z").split("\0").filter(Boolean)) {
    const file = join(dir, path);
    if (under(path, kept) || !lstatSync(file).isFile()) continue;
    const bytes = readFileSync(file);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    const rewritten = slugs.reduce((t, [from, to]) => t.replaceAll(from, to), text);
    if (rewritten !== text) writeFileSync(file, rewritten);
  }
  const patchDir = join(dir, PATCHES);
  const names = existsSync(patchDir) ? readdirSync(patchDir).filter((n) => n.endsWith(".patch")).sort() : [];
  for (const name of names) {
    const patch = join(patchDir, name);
    if (gitOk(dir, "apply", "--check", "--reverse", patch)) continue;
    if (!gitOk(dir, "apply", "--check", patch)) {
      throw new Error(`${PATCHES}/${name} no longer applies to this upstream; redo its change and regenerate it with git diff`);
    }
    git(dir, "apply", patch);
  }
}

const committedConfig = (root) => JSON.parse(git(root, "show", `HEAD:${CONFIG}`));

// The tree of upstream `ref` with HEAD's overlay applied, recording `record`
// as the new upstreamSha when given.
function rebuild(root, ref, record) {
  const head = git(root, "rev-parse", "HEAD");
  const config = committedConfig(root);
  const tmp = mkdtempSync(join(tmpdir(), "t3-pstack-fork-"));
  git(root, "worktree", "add", "--detach", tmp, ref);
  try {
    git(tmp, "checkout", head, "--", ...config.own);
    if (record) writeFileSync(join(tmp, CONFIG), `${JSON.stringify({ ...config, upstreamSha: record }, null, 2)}\n`);
    apply(tmp);
    git(tmp, "add", "-A");
    return git(tmp, "write-tree");
  } finally {
    git(root, "worktree", "remove", "--force", tmp);
  }
}

// Paths where HEAD departs from its own upstreamSha rebuilt. A sync rebuilds
// from upstream, so an edit there that no patch carries would be dropped.
function drift(root) {
  const { upstream, upstreamSha } = committedConfig(root);
  if (!gitOk(root, "cat-file", "-e", `${upstreamSha}^{commit}`)) {
    git(root, "fetch", "--no-tags", `https://github.com/${upstream}.git`, upstreamSha);
  }
  const tree = rebuild(root, upstreamSha);
  return git(root, "diff", "--name-only", tree, "HEAD").split("\n").filter(Boolean);
}

function verify(root) {
  const paths = drift(root);
  if (paths.length) {
    throw new Error(
      `HEAD departs from upstream plus the overlay in:\n${paths.map((p) => `  ${p}`).join("\n")}\n` +
        `Carry each change in a patch under ${PATCHES} (or list a fork-only file in "own" in ${CONFIG}).`,
    );
  }
}

// `repair` is for a HEAD whose patches were redone for `ref`, so they need not
// apply to the old upstreamSha any more.
function sync(root, ref, { repair = false } = {}) {
  const sha = git(root, "rev-parse", `${ref}^{commit}`);
  const { upstream, upstreamSha } = committedConfig(root);
  if (sha === upstreamSha) return null;
  if (!repair) verify(root);
  const tree = rebuild(root, sha, sha);
  return git(root, "commit-tree", tree, "-p", "HEAD", "-p", sha, "-m", `Sync ${upstream} to ${sha.slice(0, 7)}`);
}

const invoked = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : null;
if (invoked === fileURLToPath(import.meta.url)) {
  const [command, arg, ...flags] = process.argv.slice(2);
  try {
    const root = git(process.cwd(), "rev-parse", "--show-toplevel");
    if (command === "apply") apply(arg ?? root);
    else if (command === "verify") verify(root);
    else if (command === "sync" && arg && flags.every((f) => f === "--repair")) {
      const commit = sync(root, arg, { repair: flags.includes("--repair") });
      if (commit) console.log(commit);
    } else {
      console.error("usage: fork.mjs apply [dir] | verify | sync <upstream-ref> [--repair]");
      process.exit(2);
    }
  } catch (err) {
    console.error(err.stderr?.toString().trim() || err.message);
    process.exit(1);
  }
}
