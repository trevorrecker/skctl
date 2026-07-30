---
"@trevorrecker/skctl": patch
---

fix(raycast): force a UTF-8 locale so pbcopy keeps non-ASCII intact

- Raycast runs scripts with no locale, so `pbcopy` fell back to the C encoding and
  reinterpreted skctl's UTF-8 output, turning `—` into `‚Äî` and `→` into `‚Üí`
- also stops the clipboard restore in Paste Skill from lossily re-encoding whatever
  was on the pasteboard before
