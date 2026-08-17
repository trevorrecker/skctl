# @trevorrecker/skctl

## 0.3.0

### Minor Changes

- 366053d: feat(cli): add instruction, tag, and remote lifecycle commands

  - track shared instructions and link them into Claude Code, Codex, and OpenCode
  - activate tagged skill layers per machine
  - fast-forward the skills root and remotes from a scheduled machine job
  - detach remote skills into local source

- 366053d: feat(remotes): add and drop remotes from the command line

  - `skctl remote add <url> [alias]` derives an alias, clones, discovers every `SKILL.md` in the repository, selects them, and applies. `--skills a,b` narrows the selection
  - `skctl remote remove <alias>` drops the entry, the clone, and the skill selections it alone supplied
  - `skctl get remotes` reports `selected of available`, and `describe remote` lists what a remote offers but you have not taken
  - `skctl pull <url>` recognizes a URL: it resolves to the alias already tracking it, or names the `skctl remote add` command to run
  - a failed `remote add` no longer leaves an orphan clone behind

  Adding a remote previously meant hand-editing `skills.config.json`, which needed
  skill names you could not know before cloning.

  Fixes a `status` false positive that reported every correctly linked skill as a
  `legacy link` unless the skills root sat at `~/dev/skills`.

- 366053d: feat(cli): rework command output

  - `apply`, `pull`, and `refresh` print a per-section count table, a change log covering only what moved, and a one-line summary
  - every command shares one renderer: aligned columns, color when stdout is a terminal, and `~` in place of the home directory
  - lists size their columns to the content and drop columns that are empty, so long skill names no longer break the layout
  - `-o json` works on every command, not just `get`
  - `-q/--quiet` prints conflicts and the summary only; the scheduled refresh job now uses it
  - `--no-color` turns styling off, alongside `NO_COLOR` and `FORCE_COLOR`
  - conflicts exit with status 1, and `status` exits 1 when it finds issues

### Patch Changes

- 366053d: refactor(types): name the structured payloads and drop needless assertions

  - `applyData` and `statusData` return named `ApplyData` and `StatusData` contracts instead of `Record<string, unknown>`; the `-o json` shape is unchanged
  - action lookup tables validate with `satisfies` rather than a widening annotation
  - `initRoot` and `parseBody` return named types
  - removed four type assertions that were never needed: `parseOutput` reads the union member straight from `find`, and `parseHostList` narrows through an `isHost` predicate
  - `detachRemoteSkill` and `removeRemote` share one `ManifestChange` return type

## 0.2.1

### Patch Changes

- a9e1678: fix(raycast): force a UTF-8 locale so pbcopy keeps non-ASCII intact

  - Raycast runs scripts with no locale, so `pbcopy` fell back to the C encoding and
    reinterpreted skctl's UTF-8 output, turning `—` into `‚Äî` and `→` into `‚Üí`
  - also stops the clipboard restore in Paste Skill from lossily re-encoding whatever
    was on the pasteboard before

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
