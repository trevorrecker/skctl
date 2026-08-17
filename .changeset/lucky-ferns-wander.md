---
"@trevorrecker/skctl": minor
---

feat(raycast): treat raycast as a toggle and keep it out of the report

- `apply` keeps the scripts current without a row in every report; only a hand-edited script surfaces, as a conflict
- `skctl config set raycast on|off` turns the feature off entirely; `set raycast <dir>` still sets the target
- `skctl raycast sync` still reports in full
- the skill dropdown and the `paste: true` ordering are unchanged
