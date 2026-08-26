# Codex

## Paths managed by skctl

| Content | Path |
|---|---|
| User instructions | `${CODEX_HOME:-~/.codex}/AGENTS.md` |
| Skills | `~/.agents/skills/<name>` |
| Prompt commands | `${CODEX_HOME:-~/.codex}/prompts/<name>.md` |

`CODEX_HOME` changes the Codex configuration directory. Skctl uses it for the user
instruction file and prompt commands. Codex keeps user skills under
`~/.agents/skills`.

Each skctl invocation manages the active `CODEX_HOME`. Register other Codex homes as
machine-local targets:

```bash
skctl instruction add ~/.codex-work/AGENTS.md
```

## Instruction discovery

Codex reads one global instruction file from `CODEX_HOME`. It selects
`AGENTS.override.md` when present and otherwise reads `AGENTS.md`.

Project discovery starts at the project root and walks toward the working directory.
Codex selects at most one instruction file in each directory and merges the selected
files from broad scope to narrow scope.

Codex starts project discovery at the project root, so `~/AGENTS.md` is not part of
the normal chain for a repository below the home directory. Skctl accepts that path
as an import source and does not create it during apply. The managed global
path is `${CODEX_HOME:-~/.codex}/AGENTS.md`.

## Skill links

`~/.agents/skills` is the only user-level path Codex reads, so it carries the `agents`
surface:

```text
~/.agents/skills/<name>
  -> <skills-root>/.build/agents/<name>
```

Codex follows symlinked skill directories. It initially loads skill names and
descriptions, then reads a full `SKILL.md` when the skill runs.

`$CODEX_HOME/skills` holds skills bundled with Codex under `.system`. skctl does not write
there.

## Frontmatter

The `agents` surface holds the strict [Agent Skills](https://agentskills.io) baseline:

```text
name  description  license  compatibility  metadata  allowed-tools
```

Nothing else survives compilation for this surface, which keeps the shared copy on
the portable Agent Skills baseline.

## Duplicate names

Codex does not merge duplicates. Its documentation says that when a skill name conflicts,
"both can appear in skill selectors." A skill whose surfaces carry different instructions is
reported by `skctl apply` for exactly this reason.

See [surfaces and overlays](../surfaces.md).

## References

- [Codex AGENTS.md discovery](https://developers.openai.com/codex/guides/agents-md)
- [Codex skill discovery](https://developers.openai.com/codex/skills)
