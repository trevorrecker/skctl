# Scheduled refresh

`skctl refresh` runs one machine update in this order:

1. Fast-forward the skills root with `git pull --ff-only`.
2. Clone or fast-forward each remote in `skills.config.json`.
3. Apply the machine's active tags and instruction targets.

The root pull requires a clean working tree and an upstream branch. A dirty root
stays untouched. Remote updates and apply run independently, and the report includes
the root conflict.

## macOS

Install a user launchd job with an interval in hours:

```bash
skctl schedule install 24h
```

The job runs at load and at the configured interval. It captures `HOME` and any set
values for `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CURSOR_CONFIG_DIR`,
`OPENCODE_CONFIG_DIR`, `SKCTL_ROOT`, and `XDG_CONFIG_HOME`. Machine-local instruction targets remain available through
the skctl config file.

```bash
skctl schedule status
skctl schedule remove
```

The launch agent lives at `~/Library/LaunchAgents/dev.skctl.refresh.plist`. Output
goes to `~/.config/skctl/refresh.log`, or the matching `XDG_CONFIG_HOME` location.

The job runs with `--quiet --no-color`, so each run leaves one summary line in the log
and nothing else unless something conflicted. A conflicting run exits non-zero, which
`launchctl print` reports as the last exit status.

## Other systems

Run this command from the system scheduler:

```bash
skctl refresh --no-raycast --quiet --no-color
```

`--quiet` keeps the log to a summary line per run, and `--no-color` stops ANSI escapes
reaching a file. Drop `--no-raycast` if you want the Raycast scripts refreshed too, or
turn the feature off once with `skctl config set raycast off`.

The scheduler needs the same `HOME` and client config environment used when skctl
applies links interactively.
