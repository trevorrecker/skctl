---
"@trevorrecker/skctl": minor
---

feat(create): scaffold new skill or command source files

- adds `skctl create skill|command` to write a source file into the configured scope with valid frontmatter and a starter body
- runs one-shot from flags (`-d`, `--body`/`--body -`, `--hosts`, `--argument-hint`, `--apply`, `--force`) or prompts for name and description in a terminal
- new skills default to `paste: true`
