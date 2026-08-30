import {
  Marks,
  bold,
  columns,
  cyan,
  dim,
  dropEmptyColumns,
  green,
  joinDots,
  keyValues,
  padStart,
  red,
  report,
  sanitizeTerminalText,
  shortPath,
  shorten,
  title,
  yellow,
} from "./ui.js";
import type { DetailPair } from "./ui.js";
import { dirname, isAbsolute } from "node:path";
import type { CommandInfo, SkillInfo } from "./skills/inspect.js";
import type { DoctorEntry, DoctorReport } from "./skills/doctor.js";
import type { RemoteInfo } from "./skills/remotes.js";
import type { Action, ActionKind, Host } from "./skills/types.js";

export interface ReportSection {
  name: string;
  note?: string;
  actions: Action[];
}

export interface ApplyResult {
  verb: string;
  dryRun: boolean;
  root: string;
  hosts: readonly Host[];
  sections: ReportSection[];
}

export interface RenderOptions {
  quiet?: boolean;
  notices?: string[];
}

export interface TagInfo {
  name: string;
  active: boolean;
  skills: number;
}

export type ActionTally = Partial<Record<ActionKind, number>>;

export interface ApplySectionData {
  name: string;
  note?: string;
  counts: ActionTally;
  actions: Action[];
}

export interface ApplySummary {
  inSync: number;
  changed: number;
  conflicts: number;
}

export interface ApplyData {
  command: string;
  dryRun: boolean;
  root: string;
  hosts: readonly Host[];
  notices: readonly string[];
  sections: ApplySectionData[];
  summary: ApplySummary;
}

export interface StatusData {
  command: "status";
  root: string;
  skills: number;
  commands: number;
  issues: DoctorEntry[];
  notes: DoctorEntry[];
}

const kindOrder: ActionKind[] = ["ok", "created", "replaced", "removed", "conflict"];

const kindColor = {
  ok: dim,
  created: green,
  replaced: yellow,
  removed: yellow,
  conflict: red,
} satisfies Record<ActionKind, (text: string) => string>;

const kindMark = {
  ok: Marks.dot,
  created: Marks.added,
  replaced: Marks.changed,
  removed: Marks.removed,
  conflict: Marks.warn,
} satisfies Record<ActionKind, string>;

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

// One skill linked into two directories is one thing that moved, not two. Actions are
// filesystem operations, so the report groups them by the thing they act on and keeps
// the operation count alongside.
const kindRank: Record<ActionKind, number> = {
  ok: 0,
  removed: 1,
  replaced: 2,
  created: 3,
  conflict: 4,
};

interface ActionGroup {
  subject: string;
  kind: ActionKind;
  actions: Action[];
}

const groupActions = (actions: readonly Action[]): ActionGroup[] => {
  const groups = new Map<string, Action[]>();
  for (const action of actions) {
    const key = action.subject ?? `\u0000${action.detail}`;
    groups.set(key, [...(groups.get(key) ?? []), action]);
  }
  return [...groups.values()].map((members) => ({
    subject: members[0]?.subject ?? "",
    kind: members.reduce<ActionKind>(
      (worst, action) => (kindRank[action.kind] > kindRank[worst] ? action.kind : worst),
      "ok",
    ),
    actions: members,
  }));
};

const leadAction = (group: ActionGroup): Action =>
  group.actions.find((action) => action.kind === group.kind) ?? group.actions[0];

// Rows name the destinations a reader acts on: the client directories, not the internal
// .build/ copies every skill also links through. A single destination reads clearest as
// its full path; several read clearest as the set of directories, since the subject
// already names the file. Fall back to the build paths only when nothing else remains.
const destination = (group: ActionGroup): string => {
  const relevant = group.actions.filter((action) => action.kind === group.kind);
  const named = relevant.filter((action) => !action.detail.includes("/.build/"));
  const shown = named.length > 0 ? named : relevant;
  if (shown.length === 1) return sanitizeTerminalText(shorten(shown[0].detail));
  const dirs = [
    ...new Set(
      shown.map((action) =>
        isAbsolute(action.detail) ? dirname(action.detail) : action.detail,
      ),
    ),
  ];
  return sanitizeTerminalText(shorten(dirs.join(", ")));
};

const tally = (groups: readonly ActionGroup[]): ActionTally => {
  const counts: ActionTally = {};
  for (const group of groups) counts[group.kind] = (counts[group.kind] ?? 0) + 1;
  return counts;
};

const changesOf = (
  result: ApplyResult,
): Array<{ section: ReportSection; group: ActionGroup }> =>
  result.sections.flatMap((section) =>
    groupActions(section.actions)
      .filter((group) => group.kind !== "ok")
      .map((group) => ({ section, group })),
  );

const syncedCount = (result: ApplyResult): number =>
  result.sections.reduce(
    (total, section) =>
      total + groupActions(section.actions).filter((group) => group.kind === "ok").length,
    0,
  );

export const conflictCount = (result: ApplyResult): number =>
  result.sections.reduce(
    (total, section) =>
      total + groupActions(section.actions).filter((group) => group.kind === "conflict").length,
    0,
  );

const countsTable = (sections: readonly ReportSection[]): string[] => {
  const grouped = sections.map((section) => groupActions(section.actions));
  const tallies = grouped.map(tally);
  const digits = Math.max(
    1,
    ...tallies.flatMap((counts) => Object.values(counts).map((count) => String(count).length)),
  );
  const rows = sections.map((section, index) => {
    const counts = tallies[index] ?? {};
    const cells = kindOrder
      .filter((kind) => (counts[kind] ?? 0) > 0)
      .map((kind) => {
        const number = padStart(String(counts[kind]), digits);
        return kind === "ok" ? `${number} ${dim(kind)}` : kindColor[kind](`${number} ${kind}`);
      });
    return [
      section.name,
      ...(cells.length > 0 ? cells : [dim(Marks.none)]),
      section.note === undefined ? "" : dim(section.note),
    ];
  });
  return columns(dropEmptyColumns(rows), 3);
};

const changeLines = (
  changes: ReadonlyArray<{ section: ReportSection; group: ActionGroup }>,
): string[] => {
  const rows = changes.map(({ section, group }) => {
    const note = leadAction(group).note;
    return [
      kindColor[group.kind](kindMark[group.kind]),
      dim(section.name),
      sanitizeTerminalText(group.subject),
      destination(group),
      note === undefined ? "" : dim(shorten(sanitizeTerminalText(note))),
    ];
  });
  return columns(dropEmptyColumns(rows));
};

const applyFooter = (result: ApplyResult): string => {
  const changes = changesOf(result);
  const conflicts = changes.filter((change) => change.group.kind === "conflict").length;
  const changed = changes.length - conflicts;
  const synced = syncedCount(result);
  const pending = result.dryRun ? " pending" : "";
  const parts = [
    ...(conflicts > 0 ? [red(plural(conflicts, "conflict"))] : []),
    changed === 0 ? "nothing to do" : `${plural(changed, "change")}${pending}`,
    dim(`${synced} in sync`),
  ];
  return `${conflicts > 0 ? red(Marks.fail) : green(Marks.ok)} ${joinDots(parts)}`;
};

export const renderApply = (result: ApplyResult, options: RenderOptions = {}): string => {
  const changes = changesOf(result);
  const footer = [applyFooter(result)];
  if (options.quiet === true) {
    const conflicts = changes.filter((change) => change.group.kind === "conflict");
    return report(changeLines(conflicts), footer);
  }
  const heading = title(
    result.verb,
    result.dryRun ? dim("(dry run)") : undefined,
    `${dim(shortPath(result.root))} ${dim(Marks.arrow)} ${dim(result.hosts.join(", "))}`,
  );
  return report(
    options.notices ?? [],
    [heading],
    countsTable(result.sections),
    changeLines(changes),
    footer,
  );
};

export const applyData = (
  result: ApplyResult,
  notices: readonly string[] = [],
): ApplyData => {
  const changes = changesOf(result);
  const conflicts = conflictCount(result);
  return {
    command: result.verb,
    dryRun: result.dryRun,
    root: result.root,
    hosts: result.hosts,
    notices,
    sections: result.sections.map((section) => ({
      name: section.name,
      note: section.note,
      counts: tally(groupActions(section.actions)),
      actions: section.actions,
    })),
    summary: {
      inSync: syncedCount(result),
      changed: changes.length - conflicts,
      conflicts,
    },
  };
};

const entryLines = (
  entries: readonly DoctorEntry[],
  mark: string,
  color: (text: string) => string,
): string[] =>
  columns(
    dropEmptyColumns(
      entries.map((entry) => [
        color(mark),
        color(entry.label),
        shorten(entry.detail),
        entry.hint === undefined ? "" : dim(shorten(entry.hint)),
      ]),
    ),
  );

export const renderStatus = (
  report_: DoctorReport,
  root: string,
  options: RenderOptions = {},
): string => {
  const footer = [
    joinDots([
      report_.issues.length === 0
        ? `${green(Marks.ok)} no issues`
        : `${red(Marks.fail)} ${red(plural(report_.issues.length, "issue"))}`,
      report_.notes.length === 0 ? "" : dim(plural(report_.notes.length, "note")),
    ]),
  ];
  if (options.quiet === true) {
    return report(entryLines(report_.issues, Marks.fail, red), footer);
  }
  return report(
    [title("status", dim(shortPath(root)))],
    keyValues([
      ["source", `${plural(report_.sourceSkillCount, "skill")}, ${plural(report_.sourceCommandCount, "command")}`],
    ]),
    entryLines(report_.issues, Marks.fail, red),
    entryLines(report_.notes, Marks.dot, dim),
    footer,
  );
};

export const statusData = (report_: DoctorReport, root: string): StatusData => ({
  command: "status",
  root,
  skills: report_.sourceSkillCount,
  commands: report_.sourceCommandCount,
  issues: report_.issues,
  notes: report_.notes,
});

const table = (
  headers: readonly string[],
  rows: ReadonlyArray<readonly string[]>,
): string[] => {
  const keep = headers.map((_, index) => rows.some((row) => (row[index] ?? "") !== ""));
  const filter = (row: readonly string[]): string[] =>
    row.filter((_, index) => keep[index] === true);
  return columns([filter(headers.map(dim)), ...rows.map(filter)]);
};

const stateMark = (enabled: boolean): string =>
  enabled ? green(Marks.on) : dim(Marks.off);

const listFooter = (total: number, word: string, enabled: number): string =>
  joinDots([
    plural(total, word),
    `${green(Marks.on)} ${dim(`${enabled} enabled`)}`,
    total - enabled === 0 ? "" : `${dim(Marks.off)} ${dim(`${total - enabled} disabled`)}`,
  ]);

export const renderSkills = (skills: readonly SkillInfo[], scope: string): string => {
  if (skills.length === 0) return report([dim("no skills")]);
  const rows = skills.map((skill) => [
    stateMark(skill.enabled),
    skill.enabled ? skill.name : dim(skill.name),
    dim(skill.hosts.join(",")),
    skill.tags.join(","),
    skill.remote === undefined ? "" : cyan(skill.remote),
    skill.paste ? dim("paste") : "",
  ]);
  return report(
    [title("skills", dim(scope))],
    table(["", "NAME", "HOSTS", "TAGS", "REMOTE", "FLAGS"], rows),
    [listFooter(skills.length, "skill", skills.filter((skill) => skill.enabled).length)],
  );
};

export const renderCommands = (commands: readonly CommandInfo[], scope: string): string => {
  if (commands.length === 0) return report([dim("no commands")]);
  const rows = commands.map((command) => [
    stateMark(command.enabled),
    command.enabled ? command.name : dim(command.name),
    dim(command.hosts.join(",")),
  ]);
  return report(
    [title("commands", dim(scope))],
    table(["", "NAME", "HOSTS"], rows),
    [listFooter(commands.length, "command", commands.filter((command) => command.enabled).length)],
  );
};

const clip = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, width - 1).trimEnd()}…`;

const remoteState = (remote: RemoteInfo): string =>
  remote.cloned ? (remote.head === undefined ? "cloned" : `cloned@${remote.head}`) : "not cloned";

export const unselectedSkills = (remote: RemoteInfo): string[] =>
  remote.catalog.filter((entry) => !entry.selected).map((entry) => entry.selector);

const selectionCount = (remote: RemoteInfo): string =>
  `${remote.skills.length} of ${remote.cloned ? remote.catalog.length : "?"}`;

const groupCount = (remote: RemoteInfo): number =>
  new Set(remote.catalog.map((entry) => entry.group?.path ?? "")).size;

// A multi-plugin repository is the reason a selector can be path-qualified, so the tree groups
// by plugin and prints the selector rather than the bare name.
export const remoteCatalogLines = (remote: RemoteInfo): string[] => {
  if (!remote.cloned) return [dim("unknown until cloned")];
  if (remote.catalog.length === 0) return [dim(Marks.none)];
  const groups = new Map<string, typeof remote.catalog>();
  for (const entry of remote.catalog) {
    const key = entry.group?.path ?? "";
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.entries()].flatMap(([path, entries]) => {
    const group = entries[0].group;
    const heading = group === undefined ? "" : sanitizeTerminalText(group.name ?? path);
    const description =
      group?.description === undefined ? undefined : sanitizeTerminalText(group.description);
    return [
      ...(heading === ""
        ? []
        : [description === undefined ? heading : `${heading}  ${dim(clip(description, 56))}`]),
      ...entries.map(
        (entry) =>
          `  ${entry.selected ? green(Marks.on) : dim(Marks.off)} ${
            entry.selected
              ? sanitizeTerminalText(entry.selector)
              : dim(sanitizeTerminalText(entry.selector))
          }`,
      ),
    ];
  });
};

export const renderRemotes = (remotes: readonly RemoteInfo[]): string => {
  if (remotes.length === 0) {
    return report([dim("no remotes")], [dim("add one with `skctl remote add <url>`")]);
  }
  const rows = remotes.map((remote) => [
    remote.cloned ? green(Marks.on) : yellow(Marks.off),
    sanitizeTerminalText(remote.alias),
    dim(sanitizeTerminalText(remote.url)),
    unselectedSkills(remote).length > 0 ? yellow(selectionCount(remote)) : selectionCount(remote),
    groupCount(remote) > 1 ? dim(plural(groupCount(remote), "plugin")) : "",
    remote.cloned ? dim(remoteState(remote)) : yellow(remoteState(remote)),
  ]);
  const spare = remotes.reduce((total, remote) => total + unselectedSkills(remote).length, 0);
  return report([title("remotes")], table(["", "ALIAS", "URL", "SKILLS", "", "STATE"], rows), [
    joinDots([
      plural(remotes.length, "remote"),
      spare === 0 ? "" : yellow(`${spare} available, not selected`),
      dim("run `skctl pull` to update"),
    ]),
  ]);
};

// A long tail of names buries the line. Past five, keep the first four and tally the
// rest so the reader sees what they skipped without scrolling a wall of skills.
const collapseNames = (names: readonly string[]): string =>
  names.length > 5
    ? `${names.slice(0, 4).join(", ")}, and ${names.length - 4} more`
    : names.join(", ");

export const renderRemoteAdded = (
  alias: string,
  available: readonly string[],
  selected: readonly string[],
): string[] => {
  const spare = available.filter((name) => !selected.includes(name));
  return [
    `added remote '${sanitizeTerminalText(alias)}' with ${plural(selected.length, "skill")}`,
    dim(`selected: ${selected.map(sanitizeTerminalText).join(", ")}`),
    ...(spare.length > 0
      ? [dim(`not selected: ${collapseNames(spare.map(sanitizeTerminalText))}`)]
      : []),
  ];
};

export const renderTags = (tags: readonly TagInfo[]): string => {
  if (tags.length === 0) return report([dim("no tags")]);
  const rows = tags.map((tag) => [
    stateMark(tag.active),
    tag.active ? tag.name : dim(tag.name),
    String(tag.skills),
  ]);
  return report([title("tags")], table(["", "NAME", "SKILLS"], rows), [
    joinDots([
      plural(tags.length, "tag"),
      `${green(Marks.on)} ${dim(`${tags.filter((tag) => tag.active).length} active`)}`,
    ]),
  ]);
};

export const renderDetails = (
  kind: string,
  name: string,
  pairs: readonly DetailPair[],
  body?: string,
): string =>
  report(
    [`${dim(kind)}  ${bold(name)}`],
    keyValues(pairs),
    body === undefined || body === "" ? [] : [body],
  );

export const renderNotice = (lines: readonly string[]): string => report(lines);

export const renderError = (message: string): string =>
  `${red(Marks.fail)} ${message.split("\n").map(sanitizeTerminalText).join("\n  ")}\n`;

const flagGroup = (heading: string, rows: ReadonlyArray<readonly [string, string]>): string[] => [
  dim(heading),
  ...columns(rows.map(([flag, text]) => [`  ${flag}`, dim(text)])),
];

type UsageEntry = readonly [string, string];

const usageGroups: ReadonlyArray<readonly [string, ReadonlyArray<UsageEntry>]> = [
  [
    "INSTALL SKILLS FROM A GIT REPOSITORY",
    [
      ["skctl remote add <url>", "clone it, select every skill it ships, and apply"],
      ["skctl describe remote <alias>", "review what it shipped and what you skipped"],
      ["skctl disable skill <name>", "stop using one of them"],
      ["", ""],
      ["skctl remote add <url> --skills a,b", "take only some, instead of all"],
      ["skctl import", "a different job: adopt skills already loose in ~/.agents/skills"],
    ],
  ],
  [
    "SOURCE",
    [
      ["init [dir]", "scaffold and register a skills root (default: cwd)"],
      ["create skill|command [name]", "scaffold a source file, interactive if name omitted"],
      ["import [skills|instructions]", "adopt loose local skills or home instructions"],
      ["detach skill <name>", "copy a remote skill into local source"],
    ],
  ],
  [
    "REMOTES",
    [
      ["remote add <url> [alias]", "clone a repository and select its skills"],
      ["remote remove <alias>", "drop a remote, its clone, and its selections"],
      ["remote list", "same view as `get remotes`"],
      ["browse [alias|url]", "pick skills from a remote's tree, then apply"],
      ["pull [remote]", "fast-forward tracked remotes, then apply"],
    ],
  ],
  [
    "INSPECT",
    [
      ["get skills|commands|remotes|tags [name]", "list, or show one entry"],
      ["get skill|command <name> -o body|raw", "print the body or the whole file"],
      ["describe skill|command|remote|tag <name>", "detailed view"],
      ["status", "report drift, read-only"],
    ],
  ],
  [
    "MANAGE",
    [
      ["apply", "reconcile the manifest into every host"],
      ["enable|disable skill|command|tag <name>", "toggle an entry, then apply"],
      ["tag|untag skill <name> <tag...>", "edit a skill's shared tags"],
      ["dest add|list|remove [path]", "manage additional destinations for instructions"],
      ["config [set root|raycast|refresh <value>]", "show or update configuration; refresh also takes off"],
      ["refresh", "update root, remotes, and client targets"],
      ["schedule install [hours]|status|remove", "manage the background refresh job"],
      ["raycast sync [--dir <path>]", "regenerate the Raycast script commands and report"],
    ],
  ],
  [
    "PROJECT A SUBSET INTO A DIRECTORY",
    [
      ["project init --tags <a,b>", "select part of the global root for this directory"],
      ["project init --skills <x,y>", "select by name instead of by tag"],
      ["project", "reconcile the directory against its recorded selection"],
      ["project status", "show what this directory takes and from where"],
      ["project remove", "clear the projection and its config"],
    ],
  ],
];

const usageLines = (): string[] => {
  const rows = usageGroups.flatMap(([heading, entries], index) => [
    ...(index === 0 ? [] : [[""]]),
    [dim(heading)],
    ...entries.map(([command, text]) =>
      command === "" ? [""] : [`  ${command}`, dim(text)],
    ),
  ]);
  return columns(rows);
};

export const renderUsage = (): string =>
  report(
    [
      title(
        "skctl",
        dim("portable agent skills, commands, and instructions across Claude Code, Codex, OpenCode, and Cursor"),
      ),
    ],
    usageLines(),
    flagGroup("GLOBAL FLAGS", [
      ["--root <dir>", "override the skills root"],
      ["--project[=DIR]", "operate on <DIR>/.agents"],
      ["-h, --help", "show usage without running a command"],
      ["-v, --version", "show the package version"],
      ["-o, --output <fmt>", "wide (default), name, json, body, raw"],
      ["--dry-run", "plan a supported write without changing files"],
      ["-q, --quiet", "print conflicts and the summary only"],
      ["--no-color", "disable color; NO_COLOR and FORCE_COLOR are honored"],
      ["--no-raycast", "skip the Raycast sync for this run"],
      ["--paste", "filter `get skills` to paste-enabled entries"],
      ["--skills <a,b>", "narrow what `remote add` or `project init` selects"],
      ["--dir <path>", "select the project or Raycast target directory"],
      ["--link, --copy", "how `project` materializes skills; link is the default"],
      ["--force", "replace a source file or a remote alias URL"],
    ]),
    flagGroup("CREATE FLAGS", [
      ["-d, --description <text>", "frontmatter description"],
      ["--body <text|->", "body content, - reads stdin"],
      ["--hosts <a,b,c>", "target hosts"],
      ["--tags <a,b>", "shared tags, skills only"],
      ["--argument-hint <text>", "commands only"],
      ["--no-paste", "skip the paste flag, skills only"],
      ["--apply", "apply immediately after creating"],
    ]),
    [dim("Root resolution: --root > SKCTL_ROOT > ~/.config/skctl/config.json")],
  );
