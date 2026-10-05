---
"@trevorrecker/skctl": patch
---

fix(cli): honor --dry-run for enable, disable, tag, and untag

`enable` and `disable` for a tag, skill, or command now plan the apply under the proposed
selection and leave config, manifest, build output, and client links unchanged. `tag` and
`untag` report the membership change without writing `skills.config.json`.
