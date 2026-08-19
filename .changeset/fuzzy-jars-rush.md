---
"@trevorrecker/skctl": patch
---

fix(cli): count the things that changed, not the links that changed them

- one instruction linked into four client paths reads as `1 ok` with `4 links` alongside, rather than `4 ok`
- a skill written to both `~/.agents/skills` and `~/.claude/skills` is one change-log row naming both directories, rather than two rows
- a thing that half succeeded reports its worst outcome and points at the place that failed, instead of listing every destination
- the links total is omitted where each thing took exactly one operation, such as compiled commands
- a dry run with no pending work no longer reads `nothing to do pending`
