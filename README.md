# skctl

A `ctl`-style manager for portable agent skills and slash commands. Point it at a
**skills root** — a repo you own containing `skills/`, `commands/`, `remotes/`, and
`skills.config.json` — and it materializes that manifest into every agent host
(Claude Code, Codex, OpenCode) as symlinks and compiled commands.

The tool is separate from the content: anyone can keep their own skills repo and
manage it with the same binary.

## Run it

Straight from GitHub — no clone, no npm account (builds on fetch):

```bash
npx github:trevorrecker/skctl init ~/my-skills
npx github:trevorrecker/skctl status
```

Install globally from GitHub:

```bash
npm install -g github:trevorrecker/skctl
```

Or from a clone (for hacking on it):

```bash
git clone https://github.com/trevorrecker/skctl ~/dev/skctl
cd ~/dev/skctl && npm install       # builds via `prepare`
ln -sf ~/dev/skctl/dist/cli.js ~/.local/bin/skctl
```

> Not on the npm registry yet — the unscoped name `skctl` is blocked as a
> near-duplicate of an existing package. Use the GitHub specifier above; a scoped
> `@trevorrecker/skctl` may follow.

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
