---
"@trevorrecker/skctl": patch
---

fix(cli): keep internal .build/ paths out of apply output

A recompiled skill whose client links did not move now names its client directories in
the change row, instead of falling back to the internal `.build/` copies it compiles
through.
