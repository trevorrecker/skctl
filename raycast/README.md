# Raycast script commands

`skctl raycast sync` generates the `.sh` files in this directory. `skctl apply` also
runs the sync. Git ignores the generated files.

## Add to Raycast

Raycast → Settings → Extensions → Script Commands → **Add Script Directory** → select
this directory. The commands appear immediately.

| Command | What it does |
|---------|--------------|
| Apply Skills | `skctl apply` materializes the manifest into every host |
| List Skills | `skctl get skills` shows state, hosts, and paste flags |
| Paste Skill | pastes a skill's body into the focused input (skill dropdown) |
| Describe Skill | shows a skill's state, hosts, and description (skill dropdown) |

Set a Raycast alias (e.g. `sk`) or hotkey on **Paste Skill** from its command settings.

## Paste dropdown & the `paste` flag

The dropdown lists every skill; a skill meant primarily for pasting can declare it in
frontmatter, which surfaces it first and marks it `[paste]`:

```md
---
name: my-snippet
description: ...
paste: true
---
```

`skctl get skills --paste` filters to these. A common pattern is a paste-only block
kept out of every harness with `"enabled": false` in `skills.config.json` and remains
available for pasting.

The scripts prepend a sane PATH because Raycast runs with a minimal environment; they
rely on `skctl` resolving via `~/.local/bin` and a `node` from Homebrew or nvm.
