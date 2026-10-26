// The fork overlay in tools/fork, run against a throwaway repository whose
// `upstream` branch plays chhoumann/t3-pstack and whose `main` plays the fork.
import { beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../tools/fork/fork.mjs", import.meta.url));
const git = (cwd, ...args) => execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" }).trim();
const fork = (cwd, ...args) => spawnSync("node", [script, ...args], { cwd, encoding: "utf8" });
const write = (dir, path, text) => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
};

let repo;
let base;

// upstream: base. main: base plus the overlay, with one patch on a.txt.
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "fork-test-"));
  git(repo, "init", "-q", "-b", "upstream");
  git(repo, "config", "user.name", "test");
  git(repo, "config", "user.email", "test@example.com");
  write(repo, "README.md", "npx -y github:up/repo install\n");
  write(repo, "NOTICE.md", "A port of up/repo\n");
  write(repo, "test.mjs", "/github:up\\/repo/\n");
  write(repo, "a.txt", "one\ntwo\nthree\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  base = git(repo, "rev-parse", "HEAD");

  git(repo, "checkout", "-q", "-b", "main");
  const config = { upstream: "up/repo", fork: "me/repo", upstreamSha: base, own: ["tools/fork"], keepUpstreamSlug: ["NOTICE.md"] };
  write(repo, "tools/fork/fork.json", `${JSON.stringify(config, null, 2)}\n`);
  git(repo, "add", "-A");
  expect(fork(repo, "apply").status).toBe(0);
  git(repo, "add", "-A");
  write(repo, "a.txt", "one\nTWO\nthree\n");
  write(repo, "tools/fork/patches/10-a.patch", git(repo, "diff", "--", "a.txt") + "\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "fork");
});

const upstreamCommit = (files) => {
  git(repo, "checkout", "-q", "upstream");
  for (const [path, text] of Object.entries(files)) write(repo, path, text);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "upstream change");
  const sha = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-q", "main");
  return sha;
};

describe("fork overlay", () => {
  test("apply rewrites the slug outside keepUpstreamSlug, and a second run changes nothing", () => {
    expect(git(repo, "show", "HEAD:README.md")).toBe("npx -y github:me/repo install");
    expect(git(repo, "show", "HEAD:test.mjs")).toBe("/github:me\\/repo/");
    expect(git(repo, "show", "HEAD:NOTICE.md")).toBe("A port of up/repo");
    expect(fork(repo, "apply").status).toBe(0);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  test("verify passes on the fork and names an upstream file edited outside the overlay", () => {
    expect(fork(repo, "verify").status).toBe(0);
    write(repo, "README.md", "edited by hand\n");
    git(repo, "commit", "-q", "-am", "hand edit");
    const r = fork(repo, "verify");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("  README.md");
  });

  test("sync rebuilds a new upstream commit with the overlay, then reports nothing to do", () => {
    const next = upstreamCommit({ "a.txt": "one\ntwo\nthree\nfour\n", "b.txt": "see up/repo\n" });
    const main = git(repo, "rev-parse", "HEAD");
    const r = fork(repo, "sync", next);
    expect(r.status).toBe(0);
    const commit = r.stdout.trim();
    expect(git(repo, "rev-list", "--parents", "-n", "1", commit).split(" ").slice(1)).toEqual([main, next]);
    expect(git(repo, "show", `${commit}:a.txt`)).toBe("one\nTWO\nthree\nfour");
    expect(git(repo, "show", `${commit}:b.txt`)).toBe("see me/repo");
    expect(git(repo, "show", `${commit}:NOTICE.md`)).toBe("A port of up/repo");
    expect(JSON.parse(git(repo, "show", `${commit}:tools/fork/fork.json`)).upstreamSha).toBe(next);

    git(repo, "checkout", "-q", commit);
    expect(fork(repo, "verify").status).toBe(0);
    expect(fork(repo, "sync", next)).toMatchObject({ status: 0, stdout: "" });
  });

  test("sync fails and names the patch when upstream rewrote the line it changes", () => {
    const next = upstreamCommit({ "a.txt": "one\ndeux\nthree\n" });
    const r = fork(repo, "sync", next);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("tools/fork/patches/10-a.patch no longer applies");
    expect(git(repo, "worktree", "list").split("\n")).toHaveLength(1);
  });
});
