# This fork

`takahudi/t3-pstack` is [chhoumann/t3-pstack](https://github.com/chhoumann/t3-pstack) with two changes, and a daily job that carries them onto each new upstream commit.

## Single provider

Upstream needs at least two model families. Its panels (`arena runners`, `architect runners`, `interrogate reviewers`) must span two families, and a required review stays `BLOCKED: independent review` until a reviewer from another family runs. On a T3 with only Claude Code or only Codex, that gate never opens.

Here, pstack runs on a single provider when the sheet's `interrogate reviewers` line names one family, or, with no such line, when `orchestrator_capabilities` lists models of one family only. Every rule that asks for another family then takes another model of the same family, or a fresh child on the same model, and that reviewer opens the gate. Run `/t3-pstack:setup-pstack` and give every role your provider's targets. Give each panel two or more seats on that family, as different models or as one model at two reasoning levels:

```markdown
interrogate reviewers: claudeAgent/claude-opus-5-5 effort=xhigh, claudeAgent/claude-fable-5-1 effort=xhigh
```

```markdown
interrogate reviewers: codex/gpt-6.1-sol reasoningEffort=xhigh, codex/gpt-6.1-sol reasoningEffort=high
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
- upstream's repository slug rewritten to the fork's in every file except those in `keepUpstreamSlug` (the changelog and the attribution notices);
- the patches in [`tools/fork/patches`](tools/fork/patches), applied in name order.

[`tools/fork/fork.mjs`](tools/fork/fork.mjs) applies it:

```shell
node tools/fork/fork.mjs apply            # apply the overlay to the working tree; a second run changes nothing
node tools/fork/fork.mjs verify           # HEAD must equal upstreamSha rebuilt with the overlay
node tools/fork/fork.mjs sync <ref>       # print a commit on HEAD whose tree is <ref> rebuilt
```

[`.github/workflows/fork.yml`](.github/workflows/fork.yml) runs `verify` on every pull request and push to `main`, so an edit to an upstream file that no patch carries fails before it merges. A sync rebuilds from upstream and would drop such an edit. Every day at 03:17 UTC, and on demand from the Actions tab, it fetches upstream's `main`. When that has moved, it builds the sync commit, runs the generator check and the tests on it, pushes `upstream-sync/<sha>`, and opens a pull request. When a check fails, the pull request is a draft. When a patch no longer applies, there is no pull request. Either way the run fails, so GitHub notifies you, and its log names the cause. Merge a sync pull request with a merge commit or a squash. `upstreamSha` records the base either way.

A pull request opened with `GITHUB_TOKEN` does not start other workflows, so `ci.yml` does not run on a sync pull request. The sync job runs the generator check and the test suite itself. The workflow needs **Settings > Actions > General > Allow GitHub Actions to create and approve pull requests**.

### Changing the fork

1. Edit the upstream file.
2. Write the change as a patch against the tree with only the earlier overlay steps applied. For a file that has no other patch, `git diff -- <file> > tools/fork/patches/<nn>-<name>.patch` before you commit does that. Never put upstream's slug in a patch's added lines, since the rewrite runs before the patches.
3. Commit, then run `node tools/fork/fork.mjs verify`.
