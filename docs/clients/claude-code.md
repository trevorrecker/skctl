# Claude Code

## Paths managed by skctl

| Content | Path |
|---|---|
| User instructions | `${CLAUDE_CONFIG_DIR:-~/.claude}/CLAUDE.md` |
| Skills | `${CLAUDE_CONFIG_DIR:-~/.claude}/skills/<name>` |
| Commands | `${CLAUDE_CONFIG_DIR:-~/.claude}/commands/<name>.md` |

`CLAUDE_CONFIG_DIR` replaces the default `~/.claude` directory for Claude Code
configuration. Skctl uses the same directory for instructions, skills, and commands.

## Instruction discovery

Claude Code loads its user instruction file before project instruction files. It
also walks from the filesystem root toward the working directory and loads matching
`CLAUDE.md` files along that path.

When work runs under the user home directory, a `~/CLAUDE.md` file can also load
through hierarchy discovery:

```text
${CLAUDE_CONFIG_DIR:-~/.claude}/CLAUDE.md
~/CLAUDE.md
```

The config-directory file has user scope. The home file has hierarchy scope and
appears later in the merged instructions. Skctl manages the config-directory file
and leaves `~/CLAUDE.md` absent. `skctl import instructions` can adopt a matching home
file, and `skctl status` reports one that remains beside the tracked source.

Claude Code reads `CLAUDE.md`. It does not use `AGENTS.md` directly. A symlink from a
Claude path to `instructions/AGENTS.md` gives it the same content without maintaining
a second source.

## Skill links

For global roots, skctl creates this chain:

```text
${CLAUDE_CONFIG_DIR:-~/.claude}/skills/<name>
  -> ~/.agents/skills/<name>
  -> <skills-root>/skills/<name>
```

Remote skills end at their selected directory under `<skills-root>/remotes/`.

## References

- [Claude Code memory and instruction scopes](https://code.claude.com/docs/en/memory)
- [Claude Code configuration directory](https://code.claude.com/docs/en/claude-directory)
