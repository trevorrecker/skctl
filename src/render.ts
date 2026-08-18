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
  shortPath,
  shorten,
  title,
  yellow,
} from "./ui.js";
import type { DetailPair } from "./ui.js";
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

const tally = (actions: readonly Action[]): ActionTally => {
  const counts: ActionTally = {};
  for (const action of actions) counts[action.kind] = (counts[action.kind] ?? 0) + 1;
  return counts;
};

const changesOf = (
  result: ApplyResult,
): Array<{ section: ReportSection; action: Action }> =>
  result.sections.flatMap((section) =>
    section.actions
      .filter((action) => action.kind !== "ok")
      .map((action) => ({ section, action })),
  );

export const conflictCount = (result: ApplyResult): number =>
  result.sections.reduce(
    (total, section) =>
      total + section.actions.filter((action) => action.kind === "conflict").length,
    0,
  );

const countsTable = (sections: readonly ReportSection[]): string[] => {
  const tallies = sections.map((section) => tally(section.actions));
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
  changes: ReadonlyArray<{ section: ReportSection; action: Action }>,
): string[] => {
  const rows = changes.map(({ section, action }) => [
    kindColor[action.kind](kindMark[action.kind]),
    dim(section.name),
    action.subject ?? "",
    shorten(action.detail),
    action.note === undefined ? "" : dim(shorten(action.note)),
  ]);
  return columns(dropEmptyColumns(rows));
};

const applyFooter = (result: ApplyResult): string => {
  const changes = changesOf(result);
  const conflicts = changes.filter((change) => change.action.kind === "conflict").length;
  const changed = changes.length - conflicts;
  const synced = result.sections.reduce(
    (total, section) => total + section.actions.filter((action) => action.kind === "ok").length,
    0,
  );
  const pending = result.dryRun ? " pending" : "";
  const parts = [
    ...(conflicts > 0 ? [red(plural(conflicts, "conflict"))] : []),
    changed === 0 ? `nothing to do${pending}` : `${plural(changed, "change")}${pending}`,
    dim(`${synced} in sync`),
  ];
  return `${conflicts > 0 ? red(Marks.fail) : green(Marks.ok)} ${joinDots(parts)}`;
};

export const renderApply = (result: ApplyResult, options: RenderOptions = {}): string => {
  const changes = changesOf(result);
  const footer = [applyFooter(result)];
  if (options.quiet === true) {
    const conflicts = changes.filter((change) => change.action.kind === "conflict");
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
      counts: tally(section.actions),
      actions: section.actions,
    })),
    summary: {
      inSync: result.sections.reduce(
        (total, section) =>
          total + section.actions.filter((action) => action.kind === "ok").length,
        0,
      ),
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

const remoteState = (remote: RemoteInfo): string =>
  remote.cloned ? (remote.head === undefined ? "cloned" : `cloned@${remote.head}`) : "not cloned";

export const unselectedSkills = (remote: RemoteInfo): string[] =>
  remote.available.filter((name) => !remote.skills.includes(name));

const selectionCount = (remote: RemoteInfo): string =>
  `${remote.skills.length} of ${remote.cloned ? remote.available.length : "?"}`;

export const renderRemotes = (remotes: readonly RemoteInfo[]): string => {
  if (remotes.length === 0) {
    return report([dim("no remotes")], [dim("add one with `skctl remote add <url>`")]);
  }
  const rows = remotes.map((remote) => [
    remote.cloned ? green(Marks.on) : yellow(Marks.off),
    remote.alias,
    dim(remote.url),
    unselectedSkills(remote).length > 0 ? yellow(selectionCount(remote)) : selectionCount(remote),
    remote.cloned ? dim(remoteState(remote)) : yellow(remoteState(remote)),
  ]);
  const spare = remotes.reduce((total, remote) => total + unselectedSkills(remote).length, 0);
  return report([title("remotes")], table(["", "ALIAS", "URL", "SKILLS", "STATE"], rows), [
    joinDots([
      plural(remotes.length, "remote"),
      spare === 0 ? "" : yellow(`${spare} available, not selected`),
      dim("run `skctl pull` to update"),
    ]),
  ]);
};

export const renderRemoteAdded = (
  alias: string,
  available: readonly string[],
  selected: readonly string[],
): string[] => {
  const spare = available.filter((name) => !selected.includes(name));
  return [
    `added remote '${alias}' with ${plural(selected.length, "skill")}`,
    dim(`selected: ${selected.join(", ")}`),
    ...(spare.length > 0 ? [dim(`not selected: ${spare.join(", ")}`)] : []),
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
  `${red(Marks.fail)} ${message.split("\n").join("\n  ")}\n`;

const flagGroup = (heading: string, rows: ReadonlyArray<readonly [string, string]>): string[] => [
  dim(heading),
  ...columns(rows.map(([flag, text]) => [`  ${flag}`, dim(text)])),
];

type UsageEntry = readonly [string, string];

const usageGroups: ReadonlyArray<readonly [string, ReadonlyArray<UsageEntry>]> = [
  [
    "INSTALL SKILLS FROM A GIT REPOSITORY",
    [
      ["skctl remote add <url>", "clone it, take every skill it ships, link them into each host"],
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
      ["instruction list|add|remove [path]", "manage machine-local instruction targets"],
      ["config [set root|raycast|refresh <value>]", "show or update configuration; raycast takes on, off, or a directory"],
      ["refresh", "update root, remotes, and client targets"],
      ["schedule install [hours]|status|remove", "manage the background refresh job"],
      ["raycast sync [--dir <path>]", "regenerate the Raycast script commands and report"],
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
        dim("portable agent skills, commands, and instructions across Claude Code, Codex, and OpenCode"),
      ),
    ],
    usageLines(),
    flagGroup("GLOBAL FLAGS", [
      ["--root <dir>", "override the skills root"],
      ["--project[=DIR]", "operate on <DIR>/.agents"],
      ["-o, --output <fmt>", "wide (default), name, json, body, raw"],
      ["--dry-run", "plan without writing, on apply, import, and detach"],
      ["-q, --quiet", "print conflicts and the summary only"],
      ["--no-color", "disable color; NO_COLOR and FORCE_COLOR are honored"],
      ["--no-raycast", "skip the Raycast sync for this run"],
      ["--skills <a,b>", "narrow what `remote add` selects"],
    ]),
    flagGroup("CREATE FLAGS", [
      ["-d, --description <text>", "frontmatter description"],
      ["--body <text|->", "body content, - reads stdin"],
      ["--hosts <a,b,c>", "target hosts"],
      ["--tags <a,b>", "shared tags, skills only"],
      ["--argument-hint <text>", "commands only"],
      ["--no-paste", "skip the paste flag, skills only"],
      ["--apply", "apply immediately after creating"],
      ["--force", "overwrite an existing source file"],
    ]),
    [dim("Root resolution: --root > SKCTL_ROOT > ~/.config/skctl/config.json")],
  );
