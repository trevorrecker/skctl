# Raycast script commands

`skctl raycast sync` writes scripts to
`${XDG_CONFIG_HOME:-~/.config}/skctl/raycast` by default and reports what it wrote.
`skctl apply` keeps them current too, but quietly. Raycast is a machine-local
convenience outside the manifest, so it stays out of the apply report unless a script
you edited by hand blocks the sync.

Turn the whole thing off with `skctl config set raycast off`, back on with `on`, or point
it elsewhere with `skctl config set raycast <dir>`. `skctl apply --no-raycast` skips it
for a single run.

## Add to Raycast

Run `skctl config` to see the exact directory. In Raycast, open Settings > Extensions >
Script Commands > **Add Script Directory**, then select that directory. The commands
appear immediately.

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
kept out of every client with `"enabled": false` in `skills.config.json` and remains
available for pasting.

The scripts set PATH because Raycast runs with a minimal environment. They
search common local, Homebrew, system, and nvm paths for `skctl` and `node`.
