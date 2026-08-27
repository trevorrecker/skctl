# Cursor

## Paths managed by skctl

| Content | Path |
|---|---|
| Skills | `~/.agents/skills/<name>` |
| Skills, Cursor only | `${CURSOR_CONFIG_DIR:-~/.cursor}/skills/<name>` |

`CURSOR_CONFIG_DIR` selects the Cursor directory used by skctl. Cursor has no user-level
command directory, so `skctl apply` writes no commands for it. A skill is invocable as
`/skill-name`, which covers the same ground.

## Skill discovery

Cursor reads every other client's skill directory for cross-tool compatibility. At the user
level:

1. `~/.cursor/skills`
2. `~/.agents/skills`
3. `~/.claude/skills`
4. `~/.codex/skills`

It reads project directories the same way, adding `.cursor/skills` and `.agents/skills`
alongside `.claude/skills` and `.codex/skills`, and it scopes a skill found in a nested
project directory to files under that directory.

Reading all four makes Cursor, with OpenCode, one of the two clients that cannot be given
content the others do not see. skctl covers Cursor through the shared `agents` surface by
default. Its own directory carries a Cursor-only variant when a skill asks for one, and
`skctl apply` reports the resulting overlap.

## Frontmatter

The `cursor` surface is not a superset of the Agent Skills spec. Cursor takes `paths` and
`disable-model-invocation`, which the spec does not define, and does not use `license`,
`compatibility`, or `allowed-tools`:

```text
name  description  paths  disable-model-invocation  icon  color  metadata
```

The frontmatter `name` must match the directory name. skctl writes the directory name into
every compiled file, so the two cannot drift.

## References

- [Cursor agent skills](https://cursor.com/docs/skills)
- [surfaces and overlays](../surfaces.md)
