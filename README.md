# skctl

[![CI](https://github.com/trevorrecker/skctl/actions/workflows/ci.yml/badge.svg)](https://github.com/trevorrecker/skctl/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@trevorrecker/skctl)](https://www.npmjs.com/package/@trevorrecker/skctl)

A `ctl`-style manager for portable agent skills and slash commands. Point it at a
**skills root** — a repo you own containing `skills/`, `commands/`, `remotes/`, and
`skills.config.json` — and it materializes that manifest into every agent host
(Claude Code, Codex, OpenCode) as symlinks and compiled commands.

The tool is separate from the content: anyone can keep their own skills repo and
manage it with the same binary.

## Run it

No install — the package is published scoped; the command is `skctl`:

```bash
npx @trevorrecker/skctl init ~/my-skills
npx @trevorrecker/skctl status
```

Install globally:

```bash
npm install -g @trevorrecker/skctl
```

Or run from GitHub without npm (builds on fetch). npm 12 refuses git sources unless you
say so:

```bash
npx --allow-git=all github:trevorrecker/skctl status
```

Or from a clone (for hacking on it):

```bash
git clone https://github.com/trevorrecker/skctl ~/dev/skctl
cd ~/dev/skctl && npm install       # builds via `prepare`
ln -sf ~/dev/skctl/dist/cli.js ~/.local/bin/skctl
```

## Point it at a skills root

```bash
skctl init ~/dev/skills     # scaffold (if empty) + register the root
skctl config                # show the resolved root and config file
```

Resolution precedence, highest first:

1. `--root <dir>` flag
2. `SKCTL_ROOT` environment variable
3. `~/.config/skctl/config.json` (`XDG_CONFIG_HOME` honored)

## Model

- **Skills are portable, so they are symlinked.** Each enabled skill links
  `~/.agents/skills/<name>` → the root (read by Codex, OpenCode, Cursor) and
  `~/.claude/skills/<name>` → `~/.agents/skills/<name>` (Claude Code).
- **Commands differ per host, so they are compiled.** Each `commands/<name>.md`
  compiles into each host's command dir, rewriting frontmatter keys and resolving
  `<!-- host:… -->` guards.
- **Remotes are plain git clones** under `remotes/<alias>/`. The manifest's
  `remotes` section names the repo and masks which of its skills materialize.

## Commands

```
skctl init [dir]                        scaffold + register a skills root (default: cwd)
skctl config [set root|raycast <dir>]   show or update configuration
skctl create skill|command [name]       scaffold a new source file (prompts if name omitted)
skctl get skills|commands|remotes [name]    list, or one entry; -o wide|name|json
skctl get skill|command <name> -o body|raw  print body (default) or the whole file
skctl describe skill|command <name>     detailed view (state, hosts, description, path)
skctl apply [--dry-run] [--no-raycast]  reconcile the manifest into every host
skctl pull [remote]                     clone/fast-forward remotes, then apply
skctl enable  skill|command <name>
skctl disable skill|command <name>
skctl import [--dry-run]                adopt loose ~/.agents/skills dirs into the root
skctl status                            report drift (read-only)
skctl raycast sync [--dir <path>]       regenerate Raycast scripts with a live dropdown
```

Global flags: `--root <dir>`, `--project[=DIR]` (operate on `<DIR>/.agents` instead of
the global root). Compiled command files carry a generated banner and must not be
hand-edited.

## Create

`skctl create skill|command <name>` scaffolds a source file into the resolved scope with
valid frontmatter and a starter body, then prints the `apply` to run — it does not
materialize until you ask.

```bash
skctl create skill my-skill -d "what it does and when to reach for it"
skctl create command greet -d "greets someone" --argument-hint "<name>" --apply
cat draft.md | skctl create skill my-skill --body -    # body from stdin (or --body "text")
```

Run it with no `<name>` in a terminal to be prompted for the name and description. Flags:
`-d/--description`, `--body <text|->` (a leading `---` block is merged, CLI args win),
`--hosts a,b,c` (narrows the manifest entry), `--argument-hint` (commands), `--apply`
(materialize now), `--force` (overwrite). New skills get `paste: true`; `--no-paste` omits it.

## Manifest

Default-on. List a skill or command only to disable it or narrow its hosts:

```json
{
  "defaultHosts": ["claude", "codex", "opencode"],
  "remotes": {
    "pocock": {
      "url": "https://github.com/mattpocock/skills",
      "skills": ["wayfinder", "grilling"]
    }
  },
  "skills": {
    "issue-tracking": { "hosts": ["claude"] },
    "grill-me": { "enabled": false }
  },
  "commands": {}
}
```

## Raycast

`skctl raycast sync` (also run automatically by `apply`) generates Raycast Script
Commands into the raycast dir (`--dir` > `config raycast` > `<skctl>/raycast`),
baking the current skill list into a type-ahead dropdown:

| Command | What it does |
|---------|--------------|
| Apply Skills | `skctl apply` |
| List Skills | `skctl get skills` |
| Paste Skill | pastes a skill's body into the focused input (dropdown of skills) |
| Describe Skill | shows a skill's state and description (dropdown of skills) |

Add the dir once: Raycast → Settings → Extensions → Script Commands → **Add Script
Directory**. The scripts are regenerated artifacts (a `paste: true` frontmatter flag
surfaces snippet-style skills), so they are gitignored — run `skctl raycast sync`
after cloning.

## Release

CI builds, tests and pack-checks every push and pull request on Node 18, 20, 22 and 24.

Releases run on [changesets](https://github.com/changesets/changesets). Any change that
users should see ships with a note:

```bash
npx changeset          # choose patch|minor|major, write the note
```

Merging to `main` opens or updates a `chore: release` pull request that bumps the
version and folds the pending notes into `CHANGELOG.md`. Merging *that* publishes to
npm with provenance and cuts the matching GitHub Release. Tooling-only changes take an
empty changeset (`npx changeset --empty`) so the release stays quiet.

Publishing authenticates with npm [trusted
publishing](https://docs.npmjs.com/trusted-publishers) — no token, no secret. The package
carries a trusted publisher for `trevorrecker/skctl` + `release.yml`, and the job requests
`id-token: write`. The repo also needs **Settings → Actions → General → Allow GitHub
Actions to create and approve pull requests** enabled, or the release PR never opens.
