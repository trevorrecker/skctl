# Client instruction paths

The skills root owns one instruction source:

```text
<skills-root>/instructions/AGENTS.md
```

`skctl apply` compiles that source for each Claude Code, Codex, and OpenCode user path
and writes the result as a real file. Each copy resolves the source's
`<!-- host:... -->` guards for its client. A file edited by hand since skctl last wrote it
is reported as a conflict and left untouched.

`skctl dest add <path>` adds another machine-local destination and detects the client from
the directory. This supports separate client homes without putting machine paths in the
skills repository.

`skctl import instructions` accepts `~/AGENTS.md` and `~/CLAUDE.md` as home input
paths. Their content must match when both exist. The command stores the content in
the skills root, clears matching home paths, and reconciles the client links.

## Managed files

| Consumer | File |
|---|---|
| Claude Code user instructions | `${CLAUDE_CONFIG_DIR:-~/.claude}/CLAUDE.md` |
| Codex user instructions | `${CODEX_HOME:-~/.codex}/AGENTS.md` |
| OpenCode user instructions | `${OPENCODE_CONFIG_DIR:-~/.config/opencode}/AGENTS.md` |

OpenCode also reads `~/.claude/CLAUDE.md` as a fallback when its native user file
does not exist. Both files come from the tracked source when Claude Code uses its
default config directory.

## Home import inputs

| Path | Risk while present |
|---|---|
| `~/AGENTS.md` | A wrapper may treat it as shared hierarchy guidance |
| `~/CLAUDE.md` | Claude Code loads it for work under the home directory |

`skctl status` reports either path when the tracked source exists. This catches
duplicate instruction input without creating those hierarchy files during apply.

## Client details

- [Claude Code](claude-code.md)
- [Codex](codex.md)
- [OpenCode](opencode.md)
- [Cursor](cursor.md)

Each page lists the directories and frontmatter keys for one client, and mirrors the module
that encodes them under `src/providers/`. [Surfaces and overlays](../surfaces.md) covers how a
skill is shaped for more than one at once.

## Link behavior

All managed links point to the tracked source. Editing through any link edits the
same file. Moving the skills root breaks the links until `skctl apply` runs with the
configured location. `skctl status` reports missing, broken, duplicate, and
unexpected instruction paths.
