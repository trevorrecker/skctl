import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { remoteCatalogLines, renderDetails, renderNotice } from "./render.js";
import {
  cloneRemote,
  discoverRemoteCatalog,
  listRemotes,
  pruneSkillEntries,
  remoteAlias,
} from "./skills/remotes.js";
import { isValidName } from "./skills/names.js";
import {
  Marks,
  bold,
  columns,
  dim,
  green,
  joinDots,
  sanitizeTerminalText,
  shortPath,
  title,
  yellow,
} from "./ui.js";
import type { RemoteCatalogEntry, RemoteInfo } from "./skills/remotes.js";
import type { SkillPaths } from "./skills/paths.js";
import type { Action, SkillsManifest } from "./skills/types.js";

export type BrowseMode = "tree" | "filter" | "peek" | "review";

export type RowState = "on" | "off" | "partial";

export interface BrowseGroup {
  key: string;
  label: string;
  description?: string;
  entries: RemoteCatalogEntry[];
}

export interface BrowseState {
  entries: readonly RemoteCatalogEntry[];
  groups: readonly BrowseGroup[];
  selected: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  filter: string;
  cursor: number;
  mode: BrowseMode;
  exit?: "commit" | "abort";
}

export interface BrowseRow {
  kind: "group" | "skill";
  key: string;
  group: string;
  label: string;
  detail?: string;
  state: RowState;
  collapsed: boolean;
  depth: number;
}

export interface BrowseSelection {
  selectors: string[];
  added: string[];
  removed: string[];
}

export interface BrowseKey {
  name:
    | "up"
    | "down"
    | "left"
    | "right"
    | "enter"
    | "escape"
    | "space"
    | "backspace"
    | "abort"
    | "char"
    | "other";
  char?: string;
}

export interface BrowseOptions {
  target?: string;
  interactive: boolean;
}

export interface BrowseResult {
  text: string;
  data: unknown;
  manifest?: SkillsManifest;
  actions?: Action[];
  notices?: string[];
}

const groupsOf = (entries: readonly RemoteCatalogEntry[]): BrowseGroup[] => {
  const groups: BrowseGroup[] = [];
  for (const entry of entries) {
    const key = entry.group?.path ?? "";
    const existing = groups.find((group) => group.key === key);
    if (existing !== undefined) {
      existing.entries.push(entry);
      continue;
    }
    groups.push({
      key,
      label: entry.group?.name ?? key,
      description: entry.group?.description,
      entries: [entry],
    });
  }
  return groups;
};

export const browseState = (entries: readonly RemoteCatalogEntry[]): BrowseState => ({
  entries,
  groups: groupsOf(entries),
  selected: new Set(entries.filter((entry) => entry.selected).map((entry) => entry.path)),
  collapsed: new Set(),
  filter: "",
  cursor: 0,
  mode: "tree",
});

const matchesFilter = (state: BrowseState, entry: RemoteCatalogEntry): boolean => {
  const filter = state.filter.trim().toLowerCase();
  if (filter === "") return true;
  return [entry.name, entry.selector, entry.group?.path ?? "", entry.group?.name ?? ""]
    .join(" ")
    .toLowerCase()
    .includes(filter);
};

const visibleEntries = (state: BrowseState, group: BrowseGroup): RemoteCatalogEntry[] =>
  group.entries.filter((entry) => matchesFilter(state, entry));

const groupState = (
  state: BrowseState,
  entries: readonly RemoteCatalogEntry[],
): RowState => {
  const chosen = entries.filter((entry) => state.selected.has(entry.path)).length;
  if (chosen === 0) return "off";
  return chosen === entries.length ? "on" : "partial";
};

export const browseRows = (state: BrowseState): BrowseRow[] =>
  state.groups.flatMap((group): BrowseRow[] => {
    const entries = visibleEntries(state, group);
    if (entries.length === 0) return [];
    const bare = group.key === "";
    const collapsed = state.collapsed.has(group.key);
    const skills =
      bare || !collapsed
        ? entries.map((entry): BrowseRow => ({
            kind: "skill",
            key: entry.path,
            group: group.key,
            label: entry.name,
            detail: entry.selector === entry.name ? undefined : entry.selector,
            state: state.selected.has(entry.path) ? "on" : "off",
            collapsed: false,
            depth: bare ? 0 : 1,
          }))
        : [];
    if (bare) return skills;
    return [
      {
        kind: "group",
        key: group.key,
        group: group.key,
        label: group.label === "" ? group.key : group.label,
        detail: group.description,
        state: groupState(state, entries),
        collapsed,
        depth: 0,
      },
      ...skills,
    ];
  });

export const browseSelection = (state: BrowseState): BrowseSelection => {
  const chosen = (entry: RemoteCatalogEntry): boolean => state.selected.has(entry.path);
  return {
    selectors: state.entries.filter(chosen).map((entry) => entry.selector),
    added: state.entries
      .filter((entry) => chosen(entry) && !entry.selected)
      .map((entry) => entry.selector),
    removed: state.entries
      .filter((entry) => !chosen(entry) && entry.selected)
      .map((entry) => entry.selector),
  };
};

const clampCursor = (state: BrowseState): BrowseState => ({
  ...state,
  cursor: Math.min(state.cursor, Math.max(0, browseRows(state).length - 1)),
});

const moveCursor = (state: BrowseState, count: number, step: number): BrowseState =>
  count === 0
    ? { ...state, cursor: 0 }
    : { ...state, cursor: (state.cursor + step + count) % count };

const rowCursor = (state: BrowseState, key: string): number =>
  Math.max(0, browseRows(state).findIndex((row) => row.key === key));

const collapseRow = (state: BrowseState, row: BrowseRow | undefined): BrowseState => {
  if (row === undefined || row.group === "") return state;
  const collapsed = new Set(state.collapsed);
  collapsed.add(row.group);
  const folded = { ...state, collapsed };
  return { ...folded, cursor: rowCursor(folded, row.group) };
};

const expandRow = (state: BrowseState, row: BrowseRow | undefined): BrowseState => {
  if (row === undefined || row.kind !== "group" || !state.collapsed.has(row.key)) return state;
  const collapsed = new Set(state.collapsed);
  collapsed.delete(row.key);
  return { ...state, collapsed };
};

const toggleRow = (state: BrowseState, row: BrowseRow | undefined): BrowseState => {
  if (row === undefined) return state;
  const selected = new Set(state.selected);
  if (row.kind === "skill") {
    if (selected.has(row.key)) selected.delete(row.key);
    else selected.add(row.key);
    return { ...state, selected };
  }
  const group = state.groups.find((candidate) => candidate.key === row.key);
  if (group === undefined) return state;
  const paths = visibleEntries(state, group).map((entry) => entry.path);
  const clearing = paths.every((path) => selected.has(path));
  for (const path of paths) {
    if (clearing) selected.delete(path);
    else selected.add(path);
  }
  return { ...state, selected };
};

const reduceTree = (state: BrowseState, key: BrowseKey): BrowseState => {
  const rows = browseRows(state);
  const row = rows[state.cursor];
  if (key.name === "up" || key.char === "k") return moveCursor(state, rows.length, -1);
  if (key.name === "down" || key.char === "j") return moveCursor(state, rows.length, 1);
  if (key.name === "left" || key.char === "h") return collapseRow(state, row);
  if (key.name === "right" || key.char === "l") return expandRow(state, row);
  if (key.name === "space") return toggleRow(state, row);
  if (key.name === "enter") return { ...state, mode: "review" };
  if (key.name === "escape") {
    return state.filter === "" ? state : clampCursor({ ...state, filter: "" });
  }
  if (key.char === "p") return row?.kind === "skill" ? { ...state, mode: "peek" } : state;
  if (key.char === "/") return { ...state, mode: "filter" };
  if (key.char === "q") return { ...state, exit: "abort" };
  return state;
};

const reduceFilter = (state: BrowseState, key: BrowseKey): BrowseState => {
  if (key.name === "enter") return clampCursor({ ...state, mode: "tree" });
  if (key.name === "escape") return clampCursor({ ...state, mode: "tree", filter: "" });
  if (key.name === "backspace") {
    return clampCursor({ ...state, filter: state.filter.slice(0, -1) });
  }
  if (key.name === "space") return clampCursor({ ...state, filter: `${state.filter} ` });
  if (key.char !== undefined) {
    return clampCursor({ ...state, filter: `${state.filter}${key.char}` });
  }
  return state;
};

const reduceReview = (state: BrowseState, key: BrowseKey): BrowseState => {
  if (key.name === "enter") return { ...state, exit: "commit" };
  if (key.char === "q") return { ...state, exit: "abort" };
  if (key.name === "escape") return { ...state, mode: "tree" };
  return state;
};

export const browseReduce = (state: BrowseState, key: BrowseKey): BrowseState => {
  if (key.name === "abort") return { ...state, exit: "abort" };
  if (state.mode === "peek") return { ...state, mode: "tree" };
  if (state.mode === "review") return reduceReview(state, key);
  if (state.mode === "filter") return reduceFilter(state, key);
  return reduceTree(state, key);
};

const escapeChar = "\u001B";

const arrowName = (final: string): BrowseKey["name"] | undefined => {
  switch (final) {
    case "A":
      return "up";
    case "B":
      return "down";
    case "C":
      return "right";
    case "D":
      return "left";
    default:
      return undefined;
  }
};

export const parseKeys = (data: string): BrowseKey[] => {
  const keys: BrowseKey[] = [];
  let index = 0;
  while (index < data.length) {
    const char = data[index];
    if (char === escapeChar && (data[index + 1] === "[" || data[index + 1] === "O")) {
      let end = index + 2;
      while (end < data.length && !/[@-~]/.test(data[end])) end += 1;
      const name = end < data.length ? arrowName(data[end]) : undefined;
      keys.push(name === undefined ? { name: "other" } : { name });
      index = end + 1;
      continue;
    }
    index += 1;
    if (char === escapeChar) keys.push({ name: "escape" });
    else if (char === "\u0003" || char === "\u0004") keys.push({ name: "abort" });
    else if (char === "\r" || char === "\n") keys.push({ name: "enter" });
    else if (char === "\u007F" || char === "\b") keys.push({ name: "backspace" });
    else if (char === " ") keys.push({ name: "space" });
    else keys.push(char >= " " ? { name: "char", char } : { name: "other" });
  }
  return keys;
};


const markOf = (state: RowState): string => {
  if (state === "on") return green(Marks.on);
  if (state === "partial") return yellow(Marks.partial);
  return dim(Marks.off);
};

const clip = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;

const treeCell = (row: BrowseRow): string =>
  row.kind === "group"
    ? `${row.collapsed ? Marks.foldClosed : Marks.foldOpen} ${sanitizeTerminalText(row.label)}`
    : `${" ".repeat(row.depth * 2 + 2)}${sanitizeTerminalText(row.label)}`;

interface Viewport {
  rows: number;
  columns: number;
}

const treeHints = [
  "↑↓ move",
  "←→ fold",
  "space select",
  "/ filter",
  "p peek",
  "enter review",
  "q quit",
];

const treeHeading = (state: BrowseState, label: string): string =>
  title(
    "browse",
    dim(sanitizeTerminalText(label)),
    dim(`${state.selected.size} of ${state.entries.length} selected`),
    state.filter === "" && state.mode !== "filter"
      ? undefined
      : yellow(`/${state.filter}${state.mode === "filter" ? "▌" : ""}`),
  );

const treeFrame = (state: BrowseState, label: string, view: Viewport): string[] => {
  const rows = browseRows(state);
  const room = Math.max(1, view.rows - 4);
  const start = Math.max(0, Math.min(state.cursor - Math.floor(room / 2), rows.length - room));
  const window = rows.slice(start, start + room);
  const body = columns(
    window.map((row, index) => {
      const active = start + index === state.cursor;
      return [
        active ? bold(Marks.arrow) : " ",
        markOf(row.state),
        active ? bold(treeCell(row)) : treeCell(row),
        row.detail === undefined ? "" : dim(clip(sanitizeTerminalText(row.detail), 44)),
      ];
    }),
    1,
  );
  return [
    treeHeading(state, label),
    "",
    ...(rows.length === 0 ? [dim("nothing matches")] : body),
    "",
    dim(joinDots(state.mode === "filter" ? ["enter accept", "esc clear"] : treeHints)),
  ];
};

const reviewFrame = (state: BrowseState, label: string): string[] => {
  const selection = browseSelection(state);
  const changes = columns(
    [
      ...selection.added.map((selector) => [green(Marks.added), sanitizeTerminalText(selector)]),
      ...selection.removed.map((selector) => [
        yellow(Marks.removed),
        sanitizeTerminalText(selector),
      ]),
    ],
    1,
  );
  return [
    title(
      "review",
      dim(sanitizeTerminalText(label)),
      dim(`${selection.selectors.length} selected`),
    ),
    "",
    ...(changes.length === 0 ? [dim("no changes")] : changes),
    "",
    dim(joinDots(["enter apply", "esc back", "q quit"])),
  ];
};

const peekFrame = (label: string, body: string, view: Viewport): string[] => {
  const room = Math.max(1, view.rows - 5);
  const lines = body
    .split("\n")
    .map((line) => clip(sanitizeTerminalText(line), view.columns - 1));
  return [
    title("peek", dim(sanitizeTerminalText(label))),
    "",
    ...lines.slice(0, room),
    ...(lines.length > room ? [dim(`… ${lines.length - room} more lines`)] : []),
    "",
    dim("any key returns"),
  ];
};

interface ChoiceState {
  choices: readonly RemoteInfo[];
  cursor: number;
  exit?: "pick" | "abort";
}

const reduceChoice = (state: ChoiceState, key: BrowseKey): ChoiceState => {
  const count = state.choices.length;
  if (key.name === "abort" || key.name === "escape" || key.char === "q") {
    return { ...state, exit: "abort" };
  }
  if (key.name === "up" || key.char === "k") {
    return { ...state, cursor: (state.cursor - 1 + count) % count };
  }
  if (key.name === "down" || key.char === "j") {
    return { ...state, cursor: (state.cursor + 1) % count };
  }
  if (key.name === "enter" || key.name === "space") return { ...state, exit: "pick" };
  return state;
};

const choiceFrame = (state: ChoiceState): string[] => [
  title("browse", dim("pick a remote")),
  "",
  ...columns(
    state.choices.map((remote, index) => [
      index === state.cursor ? bold(Marks.arrow) : " ",
      index === state.cursor
        ? bold(sanitizeTerminalText(remote.alias))
        : sanitizeTerminalText(remote.alias),
      dim(sanitizeTerminalText(remote.url)),
      remote.cloned
        ? dim(`${remote.skills.length} of ${remote.catalog.length}`)
        : yellow("not cloned"),
    ]),
    1,
  ),
  "",
  dim(joinDots(["↑↓ move", "enter open", "q quit"])),
];

const alternateOn = `${escapeChar}[?1049h${escapeChar}[?25l`;
const alternateOff = `${escapeChar}[?25h${escapeChar}[?1049l`;
const clearScreen = `${escapeChar}[H${escapeChar}[2J`;

const viewport = (): Viewport => ({
  rows: process.stdout.rows > 0 ? process.stdout.rows : 24,
  columns: process.stdout.columns > 0 ? process.stdout.columns : 100,
});

const paint = (lines: readonly string[]): void => {
  process.stdout.write(`${clearScreen}${lines.join("\r\n")}`);
};

const withTerminal = async <T>(run: () => Promise<T>): Promise<T> => {
  const wasRaw = process.stdin.isRaw;
  const restore = (): void => {
    process.stdout.write(alternateOff);
    if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
  };
  const onSignal = (): void => {
    restore();
    process.exit(130);
  };
  process.stdout.write(alternateOn);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf-8");
  process.on("exit", restore);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    return await run();
  } finally {
    process.off("exit", restore);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    restore();
  }
};

const drive = <T extends { exit?: string }>(
  initial: T,
  reduce: (state: T, key: BrowseKey) => T,
  draw: (state: T) => void,
): Promise<T> =>
  new Promise((resolve) => {
    let state = initial;
    const onResize = (): void => draw(state);
    const onData = (chunk: string | Buffer): void => {
      for (const key of parseKeys(chunk.toString())) {
        state = reduce(state, key);
        if (state.exit !== undefined) {
          process.stdin.off("data", onData);
          process.stdout.off("resize", onResize);
          resolve(state);
          return;
        }
      }
      draw(state);
    };
    process.stdin.on("data", onData);
    process.stdout.on("resize", onResize);
    draw(state);
  });

const git = (args: string[]): string =>
  execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const cloneHead = (clonePath: string): string | undefined => {
  try {
    return git(["-C", clonePath, "rev-parse", "--short", "HEAD"]);
  } catch {
    return undefined;
  }
};

const peekBody = (clonePath: string, path: string): string => {
  try {
    return readFileSync(join(clonePath, path, "SKILL.md"), "utf-8");
  } catch {
    return dim("cannot read SKILL.md");
  }
};

const runPicker = (
  initial: BrowseState,
  label: string,
  clonePath: string,
): Promise<BrowseState> =>
  withTerminal(() =>
    drive(initial, browseReduce, (state) => {
      const view = viewport();
      if (state.mode === "peek") {
        const row = browseRows(state)[state.cursor];
        paint(
          row === undefined
            ? treeFrame(state, label, view)
            : peekFrame(row.detail ?? row.label, peekBody(clonePath, row.key), view),
        );
        return;
      }
      paint(
        state.mode === "review" ? reviewFrame(state, label) : treeFrame(state, label, view),
      );
    }),
  );

const chooseRemote = async (
  choices: readonly RemoteInfo[],
): Promise<RemoteInfo | undefined> => {
  const initial: ChoiceState = { choices, cursor: 0 };
  const final = await withTerminal(() =>
    drive(initial, reduceChoice, (state) =>
      paint(choiceFrame(state)),
    ),
  );
  return final.exit === "pick" ? final.choices[final.cursor] : undefined;
};

interface Target {
  alias: string;
  url: string;
  clonePath: string;
  discard: boolean;
  action: Action;
}

const looksLikeUrl = (value: string): boolean => /[:/\\]/.test(value);

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const trackedAlias = (manifest: SkillsManifest, target: string): string | undefined => {
  if (manifest.remotes[target] !== undefined) return target;
  return Object.entries(manifest.remotes).find(([, remote]) => remote.url === target)?.[0];
};

const trackedTarget = (paths: SkillPaths, alias: string, url: string): Target => {
  if (!isValidName(alias)) throw new Error(`remote alias '${alias}' is not a valid name`);
  const clonePath = join(paths.remotesDir, alias);
  if (existsSync(clonePath)) {
    return {
      alias,
      url,
      clonePath,
      discard: false,
      action: { kind: "ok", subject: alias, detail: "already cloned" },
    };
  }
  mkdirSync(paths.remotesDir, { recursive: true });
  try {
    cloneRemote(url, clonePath);
  } catch (error) {
    rmSync(clonePath, { recursive: true, force: true });
    throw new Error(`clone failed: ${message(error)}`);
  }
  return {
    alias,
    url,
    clonePath,
    discard: false,
    action: { kind: "created", subject: alias, detail: `cloned ${url}` },
  };
};

const urlTarget = (paths: SkillPaths, manifest: SkillsManifest, url: string): Target => {
  const alias = remoteAlias(url);
  if (!isValidName(alias)) throw new Error(`cannot derive a valid alias from ${url}`);
  const existing = manifest.remotes[alias];
  if (existing !== undefined) {
    throw new Error(
      `alias '${alias}' already tracks ${existing.url}\nrun \`skctl browse ${alias}\` instead`,
    );
  }
  const clonePath = join(paths.remotesDir, alias);
  if (existsSync(clonePath)) {
    throw new Error(`${shortPath(clonePath)} exists and no remote tracks it`);
  }
  return { ...trackedTarget(paths, alias, url), discard: true };
};

const resolveTarget = async (
  paths: SkillPaths,
  manifest: SkillsManifest,
  options: BrowseOptions,
): Promise<Target | undefined> => {
  if (options.target === undefined) {
    const remotes = listRemotes(paths, manifest);
    if (remotes.length === 0) {
      throw new Error(
        "no remotes configured\nrun `skctl browse <url>` to browse one that is not tracked yet",
      );
    }
    const picked = remotes.length === 1 ? remotes[0] : await chooseRemote(remotes);
    return picked === undefined ? undefined : trackedTarget(paths, picked.alias, picked.url);
  }
  const alias = trackedAlias(manifest, options.target);
  if (alias !== undefined) {
    return trackedTarget(paths, alias, manifest.remotes[alias].url);
  }
  if (!looksLikeUrl(options.target)) {
    throw new Error(
      `no remote named '${options.target}'\npass a url to browse one that is not tracked yet`,
    );
  }
  return urlTarget(paths, manifest, options.target);
};

const remoteInfo = (
  target: Target,
  catalog: RemoteCatalogEntry[],
  manifest: SkillsManifest,
): RemoteInfo => ({
  alias: target.alias,
  url: target.url,
  skills: manifest.remotes[target.alias]?.skills ?? [],
  available: catalog.map((entry) => entry.selector).sort(),
  catalog,
  cloned: true,
  head: cloneHead(target.clonePath),
});

const catalogText = (info: RemoteInfo): string =>
  renderDetails("browse", info.alias, [
    ["url", sanitizeTerminalText(info.url)],
    ["selected", `${info.skills.length} of ${info.catalog.length}`],
    ["skills", remoteCatalogLines(info)],
  ]);

const commitNotices = (
  target: Target,
  selection: BrowseSelection,
  total: number,
): string[] => [
  target.discard
    ? `added remote '${target.alias}' with ${selection.selectors.length} of ${total} skills`
    : `selected ${selection.selectors.length} of ${total} skills from '${target.alias}'`,
  ...(selection.added.length > 0
    ? [dim(`added: ${selection.added.map(sanitizeTerminalText).join(", ")}`)]
    : []),
  ...(selection.removed.length > 0
    ? [dim(`removed: ${selection.removed.map(sanitizeTerminalText).join(", ")}`)]
    : []),
];

export const browse = async (
  paths: SkillPaths,
  manifest: SkillsManifest,
  options: BrowseOptions,
): Promise<BrowseResult> => {
  if (options.target === undefined && !options.interactive) {
    const remotes = listRemotes(paths, manifest);
    if (remotes.length === 0) {
      throw new Error(
        "no remotes configured\nrun `skctl browse <url>` to browse one that is not tracked yet",
      );
    }
    return { text: remotes.map(catalogText).join(""), data: remotes };
  }

  const target = await resolveTarget(paths, manifest, options);
  if (target === undefined) return { text: renderNotice(["no changes"]), data: undefined };

  let keepClone = false;
  try {
    const catalog = discoverRemoteCatalog(
      target.clonePath,
      manifest.remotes[target.alias]?.skills ?? [],
    );
    if (catalog.length === 0) throw new Error(`no SKILL.md found in ${target.url}`);
    const info = remoteInfo(target, catalog, manifest);
    if (!options.interactive) return { text: catalogText(info), data: info };

    const label = `${target.alias}  ${shortPath(target.url)}`;
    const final = await runPicker(browseState(catalog), label, target.clonePath);
    if (final.exit !== "commit") {
      return { text: renderNotice([`browse '${target.alias}': no changes`]), data: info };
    }
    const selection = browseSelection(final);
    const result: BrowseResult = {
      text: "",
      data: { ...info, skills: selection.selectors, ...selection },
      manifest: pruneSkillEntries(paths, {
        ...manifest,
        remotes: {
          ...manifest.remotes,
          [target.alias]: { url: target.url, skills: selection.selectors },
        },
      }, selection.removed),
      actions: [target.action],
      notices: commitNotices(target, selection, catalog.length),
    };
    keepClone = true;
    return result;
  } finally {
    if (target.discard && !keepClone) {
      rmSync(target.clonePath, { recursive: true, force: true });
    }
  }
};
