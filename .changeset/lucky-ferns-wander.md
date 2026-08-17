---
"@trevorrecker/skctl": minor
---

feat(raycast): make the scripts static and stop reporting them

- the paste and describe scripts take a free-text skill argument instead of a baked dropdown, so they no longer hold a copy of the skill list and are written once
- `apply` keeps the scripts current without a row in every report; only a hand-edited script surfaces, as a conflict
- `skctl config set raycast on|off` turns the feature off entirely; `set raycast <dir>` still sets the target
- `skctl raycast sync` still reports in full
