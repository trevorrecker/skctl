---
"@trevorrecker/skctl": minor
---

feat(cli): rework command output

- `apply`, `pull`, and `refresh` print a per-section count table, a change log covering only what moved, and a one-line summary
- every command shares one renderer: aligned columns, color when stdout is a terminal, and `~` in place of the home directory
- lists size their columns to the content and drop columns that are empty, so long skill names no longer break the layout
- `-o json` works on every command, not just `get`
- `-q/--quiet` prints conflicts and the summary only; the scheduled refresh job now uses it
- `--no-color` turns styling off, alongside `NO_COLOR` and `FORCE_COLOR`
- conflicts exit with status 1, and `status` exits 1 when it finds issues
