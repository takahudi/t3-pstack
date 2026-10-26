# This fork

`takahudi/t3-pstack` is [chhoumann/t3-pstack](https://github.com/chhoumann/t3-pstack) with two changes, and a daily job that carries them onto each new upstream commit.

## Single provider

Upstream needs at least two model families. Its panels (`arena runners`, `architect runners`, `interrogate reviewers`) must span two families, and a required review stays `BLOCKED: independent review` until a reviewer from another family runs. On a T3 with only Claude Code or only Codex, that gate never opens.

Here, pstack runs on a single provider when the sheet's `interrogate reviewers` line names one family, or, with no such line, when `orchestrator_capabilities` lists models of one family only. Every rule that asks for another family then takes another model of the same family, or a fresh child on the same model, and that reviewer opens the gate. Run `/t3-pstack:setup-pstack` and give every role your provider's targets. Give each panel two or more seats on that family. Use different models, or, when the provider has one model, that model and `inherit-parent`. One model at two reasoning levels would not survive a later budget change, which sets both to one level and makes them the same target:

```markdown
interrogate reviewers: claudeAgent/claude-opus-5-5 effort=xhigh, claudeAgent/claude-fable-5-1 effort=xhigh
```

```markdown
interrogate reviewers: codex/gpt-6.1-sol reasoningEffort=xhigh, inherit-parent
```

The sheet checker accepts a panel with two families, or with two seats on its one family. A multi-provider sheet works as upstream's does.

## Claude Code and Codex install from this fork

The installer, both plugin manifests, and the docs name `takahudi/t3-pstack`. So this command installs this fork's plugin in every Claude Code and Codex home T3 can run:

```shell
npx -y github:takahudi/t3-pstack install
npx -y github:takahudi/t3-pstack doctor
```

Both marketplaces then auto-update from this fork's `main`, and `doctor` trusts this fork. The installer leaves alone any home whose `t3-pstack` marketplace still comes from `chhoumann/t3-pstack`. `doctor` prints the command that removes it. Run that, then run `install` again. The fork has no release tags, so use `main` rather than the `#v<version>` form the README shows.

## How the fork follows upstream

[`tools/fork/fork.json`](tools/fork/fork.json) declares the whole difference from upstream. The fork's tree is always upstream at `upstreamSha` plus this overlay:

- the files listed in `own`, which upstream does not have;
- upstream's repository slug rewritten to the fork's in every file except those in `keepUpstreamSlug` (the changelog, the attribution notices, and the security policy, whose reports belong upstream);
- the patches in [`tools/fork/patches`](tools/fork/patches), applied in name order.

[`tools/fork/fork.mjs`](tools/fork/fork.mjs) applies it:

```shell
node tools/fork/fork.mjs apply            # apply the overlay to the working tree; a second run changes nothing
node tools/fork/fork.mjs verify           # HEAD must equal upstreamSha rebuilt with the overlay
node tools/fork/fork.mjs sync <ref>       # print a commit on HEAD whose tree is <ref> rebuilt
```

`verify` fetches `upstreamSha` from upstream when the clone lacks it.

[`.github/workflows/fork.yml`](.github/workflows/fork.yml) runs `verify` on every pull request and push to `main`, so an edit to an upstream file that no patch carries fails before it merges. A sync rebuilds from upstream and would drop such an edit. Every day at 03:17 UTC, and on demand from the Actions tab, it fetches upstream's `main`. When that has moved, the `build` job rebuilds it with the overlay and runs the generator check, `bun test tests/`, and the skill script tests on it. That job holds no write token, since those checks run upstream's code. The `publish` job runs only this fork's `fork.mjs`, pushes the same tree to `upstream-sync/<sha>`, opens a pull request, and closes the sync pull requests it supersedes. When a check fails, the pull request is a draft. When a patch no longer applies, there is no pull request. Either way the run fails, so GitHub notifies you, and its log names the cause. Merge a sync pull request with a merge commit or a squash. `upstreamSha` records the base either way.

Give the `publish` job a token in the `FORK_SYNC_TOKEN` repository secret: a fine-grained personal access token for this repository with Contents, Workflows, and Pull requests set to read and write. Without it the job falls back to `GITHUB_TOKEN`, which has three limits:

- it cannot push a sync commit in which upstream changed a workflow file;
- the pull requests it opens do not start `ci.yml`;
- it opens pull requests only when **Settings > Actions > General > Allow GitHub Actions to create and approve pull requests** is on.

### Changing the fork

1. Edit the upstream file.
2. Write the change as a patch against the tree with only the earlier overlay steps applied. For a file that has no other patch, `git diff -- <file> > tools/fork/patches/<nn>-<name>.patch` before you commit does that. Never put upstream's slug in a patch's added lines, since the rewrite runs before the patches.
3. Commit, then run `node tools/fork/fork.mjs verify`.

### When a patch no longer applies

The failed run names the patch and the upstream commit `<sha>`. Redo the patch on that commit, then sync with `--repair`, which skips the check that the patches still apply to the old `upstreamSha`:

```shell
git switch -c repair/<sha> main
git fetch --no-tags https://github.com/chhoumann/t3-pstack.git main
git worktree add --detach ../t3-pstack-upstream <sha>
git -C ../t3-pstack-upstream checkout repair/<sha> -- tools/fork
node tools/fork/fork.mjs apply ../t3-pstack-upstream   # applies the overlay up to the failing patch, then stops
git -C ../t3-pstack-upstream add -A
# redo the failing patch's change in ../t3-pstack-upstream, then:
git -C ../t3-pstack-upstream diff -- <its files> > tools/fork/patches/<the failing patch>
git worktree remove --force ../t3-pstack-upstream
git commit -am "Redo <the failing patch> for upstream <sha>"
git merge --ff-only "$(node tools/fork/fork.mjs sync <sha> --repair)"
```

Push the branch and open a pull request. Its `overlay` check verifies the result against the new `upstreamSha`.

## Known limits

- Claude Code and Codex install a plugin update by its version number, and the fork keeps upstream's. An overlay change merged between upstream releases reaches an installed copy at the next upstream version bump.
- The single-provider rule lives in `poteto-mode`, `setup-pstack`, and `thermos`. Other skills that ask for a different family, such as `show-me-your-work`, rely on `poteto-mode`, which the session-start hook loads first.
