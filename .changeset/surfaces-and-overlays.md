---
"@trevorrecker/skctl": minor
---

feat(skills): compile client-specific surfaces and project subsets

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
- `skctl apply` adds `.build/` to the skills root's `.gitignore`, and `skctl status` reports a
  root that is missing it.

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
