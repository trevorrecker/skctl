# @trevorrecker/skctl

## 0.4.0

### Minor Changes

- e4ac619: feat(raycast): treat raycast as a toggle and keep it out of the report
  
  - `apply` keeps the scripts current without a row in every report; only a hand-edited script surfaces, as a conflict
  - `skctl config set raycast on|off` turns the feature off entirely; `set raycast <dir>` still sets the target
  - `skctl raycast sync` still reports in full
  - the skill dropdown and the `paste: true` ordering are unchanged
- cf1e2a9: feat(skills): compile client-specific surfaces and project subsets
  
  Each skill now compiles into `<root>/.build/<surface>/<name>/`, and every client path is a
  single link into that build rather than a two-hop chain through `~/.agents/skills`. Bundled
  files link back to source, so a skill's own `scripts/` stays editable in one place.
  
  - Every client accepts a different set of frontmatter keys, and compilation drops what a
    client rejects. This also stops skctl's own `paste` and `tags` keys from reaching clients.
  - Skills now honor `<!-- host:claude -->` guards. `host:raycast` targets
    the pasted form, so a Claude Code `@path` reference can stay out of the prose other clients
    read.
  - Overlays at `<root>/overlays/<name>.md` reshape a skill you do not own with ordered regex
    replacements and frontmatter edits, per surface when needed.
  - Cursor joins the host list, with `~/.cursor/skills` as its own surface. An existing manifest
    keeps the `defaultHosts` it already names.
  - OpenCode and Cursor read the other clients' directories, so a skill whose instructions
    differ across two surfaces one client reads produce a conflict. Frontmatter differing
    across surfaces is not, since that is the point.
  - `skctl describe skill` shows which surfaces a skill compiles to and which clients read it
    beyond the hosts you asked for.
  - `skctl apply` keeps generated `.build/` and `remotes/` state out of the skills root's Git
    history, and `skctl status` reports a root missing either ignore entry.
  
  Remote selections may be path-qualified, so a multi-plugin repository like
  `github.com/cursor/plugins` works: `--skills pstack/unslop,pstack/bro`. `skctl describe remote`
  groups its catalog by plugin and lists the candidates for an ambiguous bare name.
  
  `skctl browse [alias|url]` walks a remote's tree instead of making you type selectors: arrows
  move, space toggles a skill or a whole plugin, `p` peeks the `SKILL.md`, `/` filters, and enter
  reviews before committing. Clones filter out blob history, which `remote add` and `pull` now do
  too. Browsing an untracked URL clones it to look and removes the clone again if you abort.
  
  `skctl project` materializes a subset of the global root into the directory you're working in,
  selected by tag or by name and recorded in `./.agents/skctl.project.json` so later runs need no
  flags. `--link` leaves symlinks into a local build; `--copy` writes real directories for a
  repository that should carry the skills.
  
  - Project copies no longer replace paths skctl does not own, and skctl ignores generated
    project state without hiding copied skills.
  - `remote add --force` stages and validates a changed URL before replacing the prior clone.
  - Help and version flags are side-effect free, unknown flags fail, and missing option values are
    reported before a command can write.
  - Package build and test scripts now run across operating systems, tests always rebuild first,
    and Raycast defaults off outside macOS.
  - Node.js 22.13 is now the oldest supported runtime. CI covers Node 22.13, 24, and 26.

### Patch Changes

- e4ac619: fix(cli): count the things that changed, not the links that changed them
  
  - one instruction linked into four client paths reads as `1 ok` with `4 links` alongside, rather than `4 ok`
  - a skill written to both `~/.agents/skills` and `~/.claude/skills` is one change-log row naming both directories, rather than two rows
  - a thing that half succeeded reports its worst outcome and points at the place that failed, instead of listing every destination
  - the links total is omitted where each thing took exactly one operation, such as compiled commands
  - a dry run with no pending work no longer reads `nothing to do pending`

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
