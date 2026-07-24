---
"@trevorrecker/skctl": patch
---

chore(frontmatter): read and write frontmatter with yaml

- replaces `gray-matter` (last published 2023, pinned to the unmaintained js-yaml 3 line) with `yaml`, dropping the install from nine packages to one
- long descriptions stay on a single line instead of folding into block scalars
- frontmatter now follows YAML 1.2, so `yes` and `on` read as strings rather than booleans
