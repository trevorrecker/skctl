---
"@trevorrecker/skctl": minor
---

feat(dest): manage additional destinations for instructions

`skctl dest add <path>` registers an additional place to materialize instructions and
detects the client from the directory, so `--as` is only needed when detection cannot tell.
`dest list` and `dest remove` round it out. Adding a destination adopts any instruction file
already there; later applies resolve the source's host guards, write the file in place, and
report a hand-edit as a conflict instead of clobbering it.

This replaces the `skctl instruction add/list/remove` commands; existing machine-local
instruction targets migrate into destinations automatically on the next run.
