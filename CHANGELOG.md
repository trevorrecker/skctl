# @trevorrecker/skctl

## 0.2.0

### Minor Changes

- 942800b: feat(create): scaffold new skill or command source files

  - adds `skctl create skill|command` to write a source file into the configured scope with valid frontmatter and a starter body
  - runs one-shot from flags (`-d`, `--body`/`--body -`, `--hosts`, `--argument-hint`, `--apply`, `--force`) or prompts for name and description in a terminal
  - new skills default to `paste: true`

### Patch Changes

- f4fb448: chore(frontmatter): read and write frontmatter with yaml

  - replaces `gray-matter` (last published 2023, pinned to the unmaintained js-yaml 3 line) with `yaml`, dropping the install from nine packages to one
  - long descriptions stay on a single line instead of folding into block scalars
  - frontmatter now follows YAML 1.2, so `yes` and `on` read as strings rather than booleans

- f4fb448: chore(release): publish from ci with npm provenance

  - github actions builds, tests and pack-checks every push and pull request on node 18, 20, 22 and 24
  - merging a changeset opens a release pull request; merging that publishes to npm and cuts the github release
  - the published package no longer ships compiled test files
