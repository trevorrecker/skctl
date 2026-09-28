---
"@trevorrecker/skctl": minor
---

feat(skills): leave host built-ins alone and eject skills without deleting them

`skctl import` now skips skills Cursor or Codex ship themselves, including copies another
tool migrated into `~/.agents/skills`. `--adopt name` imports one anyway, and `--skip name`
leaves a loose skill in place and records it so no machine imports it.

`skctl eject <name>` stops managing a skill and hands it to its owner without deleting it.
A host built-in goes back to its host. Any other skill is written to `~/.agents/skills` as a
real directory. `eject --builtins` does this for every source skill that shadows a
built-in. Other machines hand an ejected skill back on their next `apply`, restoring it
from the root's git history, and `doctor` reports source skills that shadow a host
built-in.
