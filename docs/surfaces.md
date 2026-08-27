# Surfaces and overlays

A **host** is a client: Claude Code, Codex, OpenCode, Cursor. A **surface** is an output
directory. They are separate axes, because the clients read each other's directories.

You declare hosts. skctl works out the surfaces.

## Who reads what

| Surface | Directory | Claude Code | Codex | OpenCode | Cursor |
|---|---|---|---|---|---|
| `claude` | `${CLAUDE_CONFIG_DIR:-~/.claude}/skills` | yes | no | yes | yes |
| `agents` | `~/.agents/skills` | no | yes | yes | yes |
| `opencode` | `${OPENCODE_CONFIG_DIR:-~/.config/opencode}/skills` | no | no | yes | no |
| `cursor` | `${CURSOR_CONFIG_DIR:-~/.cursor}/skills` | no | no | no | yes |

Two things follow from that table, and they shape everything else here.

**Claude Code and Codex separate cleanly.** `~/.claude/skills` and `~/.agents/skills` are
disjoint for those two, so a skill can say one thing to Claude Code and another to Codex and
each sees only its own copy.

**OpenCode and Cursor do not.** Both read the compatibility directories on purpose. Each has
a directory only it reads, so you can add content for it, but it still sees the shared copies
too. When a skill's instructions differ across surfaces a client reads, `skctl apply` reports
it:

```text
!  skills  demo  opencode reads 3 variants whose instructions differ
```

Client precedence has changed across versions, and Codex does not merge duplicates.
skctl reports the overlap instead of relying on one client's current search order.

Frontmatter differing across surfaces is not reported. That is the point of compiling per
surface, and every client either accepts or ignores what it does not use.

## How surfaces get chosen

For the usual case, all four hosts, `claude` plus `agents` covers everything in two
surfaces. skctl picks the smallest set of surfaces that reaches the hosts you asked for,
prefers a directory only that host reads when one exists, and reports the hosts it reaches
that you did not ask for:

```text
skill  commit
surfaces  claude, agents  also read by cursor
```

`hosts: [claude]` cannot be honored exactly, because nothing reaches Claude Code alone.
`skctl describe skill` says so rather than letting the manifest imply otherwise.

## The build directory

Every enabled skill compiles on each apply into
`<skills-root>/.build/<surface>/<name>/`:

- `SKILL.md` is written as a real file, compiled for that surface.
- Every sibling (`scripts/`, `assets/`, `reference.md`) links back to source, so a bundled
  script stays editable in one place and `${CLAUDE_SKILL_DIR}` resolves to a complete
  directory.
- Each client path links directly to its compiled build.

`.build/` and the remote clones under `remotes/` are generated. `skctl apply` adds both
directories to the skills root's `.gitignore`, and `skctl status` reports either missing
entry. Editing a file under `.build/` accomplishes nothing; the next apply overwrites it.

Compilation removes skctl's own `paste` and `tags` keys before a client reads the file.

## Shaping a skill you own

Put the guards and the full frontmatter in the source and let the compiler strip per surface.
A guard names a host:

```markdown
<!-- host:claude -->
Read @notes.md before starting.
<!-- /host -->
<!-- host:!claude -->
Read notes.md before starting.
<!-- /host -->
```

`!` negates and a comma lists several: `<!-- host:claude,cursor -->`. This is the same syntax
commands already use.

`host:codex` routes to the `agents` surface, since that is the only user path Codex reads.
Matching stays that narrow on purpose: expanding a guard to every reader of a surface would
put `host:opencode` content into Claude Code's directory.

`host:raycast` targets the pasted form, which is what `skctl get skill <name> -o body` and the
Raycast paste script produce. That is what makes the Claude Code `@path` form above safe:
Claude Code gets the reference, everything else gets prose.

## Shaping a skill you do not own

A remote skill lives in a clone you should not edit. An overlay reshapes it on the way
through, at `<skills-root>/overlays/<name>.md`:

```markdown
---
replace:
  ProductName: the agent
  '^## Optional section[\s\S]*?(?=^## )': ''
set:
  allowed-tools: Read Grep
drop: [argument-hint]
claude:
  set:
    context: fork
---

Record why this repository-local adaptation exists.
```

| Key | Effect |
|---|---|
| `replace` | Regex source to replacement, applied in order. Patterns compile with `gm`. |
| `set` | Frontmatter keys to add or override. |
| `drop` | Frontmatter keys to remove. |
| any surface name | `replace`, `set`, and `drop` applied to that surface alone. |

The body is free prose. Use it to record why the overlay exists.

`replace` also takes an array of pairs, which is the spelling to use when a pattern looks
numeric, since a JS object hoists integer-like keys ahead of the rest and would reorder your
rules:

```yaml
replace:
  - ['404', 'gone']
  - ['gone', 'missing']
```

skctl reports an unparsable pattern as a conflict and skips it. An overlay
naming a skill that does not exist shows up in `skctl status`.

## Order of operations

1. Parse the source frontmatter.
2. Apply the overlay's `replace`, then the surface's `replace`, each in declared order.
3. Resolve `<!-- host:... -->` guards for the surface.
4. Merge frontmatter: source, then overlay `set` and `drop`, then the surface's.
5. Pin `name` to the skill's directory name.
6. Drop every key the surface does not accept, and report what was dropped.

Each client's accepted keys and directories live in one file per client under
`src/providers/`, next to the doc page for the same client under `docs/clients/`.
