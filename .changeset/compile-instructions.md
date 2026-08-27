---
"@trevorrecker/skctl": minor
---

feat(instructions): compile instructions per host

`skctl apply` now resolves the `<!-- host:... -->` guards in `instructions/AGENTS.md` for
each target and writes the file, so a `host:claude` block reaches `CLAUDE.md` but not the
`AGENTS.md` that Codex or OpenCode reads. Targets are real files rather than symlinks: skctl
records the hash of what it wrote and leaves a hand-edited target untouched, reporting it as
a conflict. `import instructions` consolidates matching home files and reports divergent ones
instead of guessing a merge, and machine-local `instruction add` targets infer their host
from the filename.
