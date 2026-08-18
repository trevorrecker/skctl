# skctl

[![CI](https://github.com/trevorrecker/skctl/actions/workflows/ci.yml/badge.svg)](https://github.com/trevorrecker/skctl/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@trevorrecker/skctl)](https://www.npmjs.com/package/@trevorrecker/skctl)

`skctl` manages agent skills, commands, and shared instructions across Claude Code,
Codex, and OpenCode. Content lives in a skills root that can be checked into Git and
used on more than one computer.

## Install

Run from npm:

```bash
npx @trevorrecker/skctl init ~/dev/skills
```

Install the command globally:

```bash
npm install -g @trevorrecker/skctl
```

Run from GitHub:

```bash
npx --allow-git=all github:trevorrecker/skctl status
```

Work from a clone:

```bash
git clone https://github.com/trevorrecker/skctl ~/dev/skctl
cd ~/dev/skctl
npm install
ln -sf ~/dev/skctl/dist/cli.js ~/.local/bin/skctl
```

## Skills root

```bash
skctl init ~/dev/skills
skctl config
```

The root can contain:

```text
commands/
instructions/
  AGENTS.md
remotes/
skills/
skills.config.json
```

Root resolution uses this order:

1. `--root <dir>`
2. `SKCTL_ROOT`
3. `~/.config/skctl/config.json`

`XDG_CONFIG_HOME` changes the config directory.

## Commands

```text
skctl init [dir]
skctl config [set root <dir>|raycast on|off|<dir>|refresh <hours>]
skctl create skill|command [name]
skctl get skills|commands|remotes|tags [name] [-o wide|name|json]
skctl get skill|command <name> -o body|raw
skctl describe skill|command|remote|tag <name>
skctl apply [--dry-run] [--no-raycast]
skctl remote add <url> [alias] [--skills a,b] | remove <alias> | list
skctl pull [remote]
skctl detach skill <name> [--dry-run]
skctl tag|untag skill <name> <tag...>
skctl enable skill|command|tag <name>
skctl disable skill|command|tag <name>
skctl import [skills|instructions] [--dry-run]
skctl instruction list|add|remove [path]
skctl refresh
skctl schedule install [hours]|status|remove
skctl status
skctl raycast sync [--dir <path>]
```

Global flags:

- `--root <dir>` selects a skills root for one invocation.
- `--project[=DIR]` uses `<DIR>/.agents` as the source.
- `-o, --output <fmt>` picks `wide` (default), `name`, `json`, `body`, or `raw`.
- `-q, --quiet` prints conflicts and the closing summary only.
- `--no-color` turns styling off.

## Output

`skctl apply` reports a count per section, a log of what moved, and a summary:

```text
  apply  ~/dev/skills → claude, codex, opencode

  instructions   4 ok
  skills        60 ok   2 removed
  commands      —

  -  skills  matt-handoff  ~/.agents/skills/matt-handoff  broken link
  -  skills  matt-handoff  ~/.claude/skills/matt-handoff  broken link

  ✔ 2 changes · 64 in sync
```

Color turns on when stdout is a terminal. `NO_COLOR`, `FORCE_COLOR`, and `--no-color`
override that.

`-o json` prints the same report as structured data, which suits scripts:

```bash
skctl apply -o json | jq '.summary'
skctl status -o json | jq '.issues'
```

A command that reports a conflict exits with status 1, and `skctl status` exits 1
when it finds issues. Everything else exits 0.

## Create

```bash
skctl create skill my-skill -d "when to use this skill"
skctl create command greet -d "greets someone" --argument-hint "<name>" --apply
skctl create skill work-tool --tags work --hosts claude,codex
cat draft.md | skctl create skill my-skill --body -
```

Create flags:

- `-d/--description <text>`
- `--body <text|->`
- `--hosts <host,...>`
- `--tags <tag,...>` for skills
- `--argument-hint <text>` for commands
- `--no-paste` for skills
- `--apply`
- `--force`

`create skill` writes `paste: true` by default. `--no-paste` omits the field.

## Import

Import adopts skills that already sit loose on this computer. To install skills from
a Git repository, use [`skctl remote add`](#remotes) instead.

`skctl import` and `skctl import skills` have the same behavior. They adopt loose
skill directories from `~/.agents/skills`, place them under the skills root, and
leave host links in their place.

```bash
skctl import --dry-run
skctl import
skctl import instructions
```

Instruction import accepts `~/AGENTS.md` and `~/CLAUDE.md` as home inputs. When
both exist, their content must match. The tracked source lives at
`instructions/AGENTS.md`, and the home hierarchy paths stay absent after import.

`skctl apply` links the tracked source to the Claude Code, Codex, and OpenCode user
instruction paths. OpenCode also reads the default Claude Code path as a fallback.
`skctl status` reports home hierarchy files that can load beside the managed user
instructions.

Extra client homes are machine-local targets:

```bash
skctl instruction add ~/.codex-work/AGENTS.md
skctl instruction list
skctl instruction remove ~/.codex-work/AGENTS.md
```

The target list lives in the local skctl config. Apply reconciles each target to the
tracked instruction source.

See [client instruction paths](docs/clients/README.md) for load order and link
behavior.

## Manifest

Skills and commands are enabled unless their entry says otherwise. A tagged skill is
enabled when at least one of its tags is active on the computer.

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
    "work-only": { "tags": ["work"] },
    "grill-me": { "enabled": false }
  },
  "commands": {}
}
```

Active tags live in the local skctl config:

```bash
skctl tag skill issue-tracking work
skctl enable tag work
skctl disable tag personal
skctl get tags
```

Untagged skills form the common layer. A tagged skill is active when any of its tags
is active on the machine. Tag assignments stay in the shared manifest; active tags
stay in local config.

## Remotes

Remote repositories are Git clones under `remotes/<alias>/`. Each remote manifest
entry selects the skills that skctl exposes to clients.

Add one by URL. skctl derives the alias from the URL, clones, finds every `SKILL.md`
in the repository, selects all of them, and applies:

```bash
skctl remote add https://github.com/dmmulroy/anti-slop
skctl remote add https://github.com/mattpocock/skills --skills wayfinder,grilling
skctl remote add https://github.com/owner/repo my-alias
```

Any layout works as long as each skill is a directory holding a `SKILL.md`. Nesting
is fine: `skills/<name>/SKILL.md` and `packages/skills/<name>/SKILL.md` both resolve.
skctl links the whole skill directory, so a skill that ships its own `scripts/` or
`assets/` keeps them reachable at the path clients see.

Narrow the selection after the fact with the usual toggle, and see what a remote
offers but you have not taken:

```bash
skctl disable skill install-anti-slop
skctl get remotes
skctl describe remote pocock
```

Update tracked remotes, or drop one along with its clone and selections:

```bash
skctl pull
skctl pull pocock
skctl remote remove pocock
skctl refresh
```

`skctl pull` takes an alias. Handing it a URL it does not track prints the
`skctl remote add` command to run instead.

`skctl refresh` fast-forwards a clean skills root, updates each remote, and applies
the machine's active tags and instruction targets. A dirty root stays untouched and
appears as a conflict in the report.

On macOS, install the launchd job with an interval in hours:

```bash
skctl schedule install 24h
skctl schedule status
skctl schedule remove
```

See [scheduled refresh](docs/scheduling.md) for job behavior and other operating
systems.

Detach copies the files in the remote clone into local source and clears that skill
from the remote selection:

```bash
skctl detach skill wayfinder
```

The local copy has no upstream metadata.

## Raycast

`skctl apply` keeps the scripts current for global roots without reporting them, since
Raycast is a machine-local convenience rather than part of the manifest. A script you
edited by hand still shows up as a conflict. `skctl raycast sync` reports in full.

The skill dropdown is baked into each script's header, because Raycast reads an
argument's options from the file before the script runs. That is why the files are
rewritten whenever the skill list changes, and why apply does it quietly.

```bash
skctl config set raycast off
skctl config set raycast on
skctl config set raycast ~/some/other/dir
skctl apply --no-raycast
```

See [Raycast setup](raycast/README.md).
