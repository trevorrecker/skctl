# OpenCode

## Paths managed by skctl

| Content | Path |
|---|---|
| User instructions | `${OPENCODE_CONFIG_DIR:-~/.config/opencode}/AGENTS.md` |
| Skills | `~/.agents/skills/<name>` |
| Skills, OpenCode only | `${OPENCODE_CONFIG_DIR:-~/.config/opencode}/skills/<name>` |
| Commands | `${OPENCODE_CONFIG_DIR:-~/.config/opencode}/commands/<name>.md` |

`OPENCODE_CONFIG_DIR` selects the OpenCode directory used by skctl for instructions
and commands. `XDG_CONFIG_HOME` continues to select the skctl config directory.

## Instruction discovery

OpenCode reads project instruction files while walking from the working directory to
the project root. At a project level, `AGENTS.md` takes precedence over a compatible
`CLAUDE.md` file.

The OpenCode user file takes precedence over the Claude Code user file. This makes
the Claude path a fallback instead of a second merged copy:

1. `${OPENCODE_CONFIG_DIR:-~/.config/opencode}/AGENTS.md`
2. `~/.claude/CLAUDE.md`

Skctl manages the native OpenCode path. With Claude Code's default config directory,
it also manages the fallback path and links both files to the same tracked source.
This keeps a native OpenCode file from hiding different instructions in the Claude
fallback.

## Skills and commands

OpenCode discovers global skills from three directories:

1. `${OPENCODE_CONFIG_DIR:-~/.config/opencode}/skills`
2. `~/.claude/skills`
3. `~/.agents/skills`

It reads all three, which makes OpenCode the client least able to receive content the
others do not see. skctl normally covers it through the shared `agents` surface. Its native
directory carries an OpenCode-only variant when a skill asks for one, and because OpenCode
still reads the other two, `skctl apply` reports the overlap rather than assuming a
precedence rule that OpenCode does not document.

## Frontmatter

The `opencode` surface keeps what OpenCode recognizes:

```text
name  description  license  compatibility  metadata
```

OpenCode ignores frontmatter it does not know, so this list keeps the file tidy rather than
avoiding an error.

See [surfaces and overlays](../surfaces.md).

Command sources compile into OpenCode Markdown command files. Host guards and
frontmatter mapping run before skctl writes the file.

## References

- [OpenCode instruction rules](https://opencode.ai/docs/rules/)
- [OpenCode skill discovery](https://opencode.ai/docs/skills/)
- [OpenCode commands](https://opencode.ai/docs/commands/)
