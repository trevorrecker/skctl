---
"@trevorrecker/skctl": minor
---

feat(remotes): add and drop remotes from the command line

- `skctl remote add <url> [alias]` derives an alias, clones, discovers every `SKILL.md` in the repository, selects them, and applies. `--skills a,b` narrows the selection
- `skctl remote remove <alias>` drops the entry, the clone, and the skill selections it alone supplied
- `skctl get remotes` reports `selected of available`, and `describe remote` lists what a remote offers but you have not taken
- `skctl pull <url>` recognizes a URL: it resolves to the alias already tracking it, or names the `skctl remote add` command to run
- a failed `remote add` no longer leaves an orphan clone behind

Adding a remote previously meant hand-editing `skills.config.json`, which needed
skill names you could not know before cloning.

Fixes a `status` false positive that reported every correctly linked skill as a
`legacy link` unless the skills root sat at `~/dev/skills`.
