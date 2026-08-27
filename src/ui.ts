import { homedir } from "node:os";
import { isAbsolute, relative, sep } from "node:path";

const ansiPattern = /\u001B\[[0-9;]*m/g;
const terminalControlPattern = /[\u0000-\u001F\u007F-\u009F]/g;

export const sanitizeTerminalText = (text: string): string =>
  text.replace(terminalControlPattern, "");

const detectColor = (): boolean => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== "0";
  if (process.env.TERM === "dumb") return false;
  return process.stdout.isTTY === true;
};

let colored = detectColor();

export const setColor = (enabled: boolean): void => {
  colored = enabled;
};

const style =
  (open: number, close: number) =>
  (text: string): string =>
    colored && text !== "" ? `\u001B[${open}m${text}\u001B[${close}m` : text;

export const bold = style(1, 22);
export const dim = style(2, 22);
export const red = style(31, 39);
export const green = style(32, 39);
export const yellow = style(33, 39);
export const cyan = style(36, 39);

export const Marks = {
  ok: "✔",
  fail: "✖",
  warn: "!",
  dot: "·",
  arrow: "→",
  on: "●",
  off: "○",
  partial: "◐",
  none: "—",
  foldOpen: "▾",
  foldClosed: "▸",
  added: "+",
  changed: "~",
  removed: "-",
};

export const width = (text: string): number => text.replace(ansiPattern, "").length;

const padEnd = (text: string, size: number): string =>
  `${text}${" ".repeat(Math.max(0, size - width(text)))}`;

export const padStart = (text: string, size: number): string =>
  `${" ".repeat(Math.max(0, size - width(text)))}${text}`;

const home = homedir();
const shortenable = home.length > 1;

export const shortPath = (path: string): string => {
  if (!shortenable) return path;
  const fromHome = relative(home, path);
  if (fromHome === "") return "~";
  if (fromHome === ".." || fromHome.startsWith(`..${sep}`) || isAbsolute(fromHome)) return path;
  return `~/${fromHome.split(sep).join("/")}`;
};

export const shorten = (text: string): string => {
  if (!shortenable) return text;
  return text.split(home).join("~").split(sep).join("/");
};

const maxColumnWidth = 52;

export const columns = (rows: readonly string[][], gap = 2): string[] => {
  const count = Math.max(0, ...rows.map((row) => row.length));
  const widths = Array.from({ length: count }, (_, index) =>
    Math.min(maxColumnWidth, Math.max(0, ...rows.map((row) => width(row[index] ?? "")))),
  );
  const spacer = " ".repeat(gap);
  return rows.map((row) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : padEnd(cell, widths[index] ?? 0)))
      .join(spacer)
      .trimEnd(),
  );
};

export const dropEmptyColumns = (rows: readonly string[][]): string[][] => {
  const count = Math.max(0, ...rows.map((row) => row.length));
  const keep = Array.from({ length: count }, (_, index) =>
    rows.some((row) => width(row[index] ?? "") > 0),
  );
  return rows.map((row) => row.filter((_, index) => keep[index] === true));
};

const indent = (lines: readonly string[], size = 2): string[] =>
  lines.map((line) => (line === "" ? line : `${" ".repeat(size)}${line}`));

const stack = (groups: ReadonlyArray<readonly string[]>): string[] =>
  groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) => (index === 0 ? [...group] : ["", ...group]));

export const report = (...groups: ReadonlyArray<readonly string[]>): string => {
  const lines = stack(groups);
  return lines.length === 0 ? "" : ["", ...indent(lines), ""].join("\n");
};

export const title = (verb: string, ...details: ReadonlyArray<string | undefined>): string =>
  [bold(verb), ...details.filter((part): part is string => part !== undefined && part !== "")].join(
    "  ",
  );

export const joinDots = (parts: readonly string[]): string =>
  parts.filter(Boolean).join(` ${dim(Marks.dot)} `);

export type DetailPair = readonly [string, string | readonly string[]];

export const keyValues = (pairs: readonly DetailPair[]): string[] => {
  const rows = pairs.flatMap(([key, value]) => {
    const values = typeof value === "string" ? [value] : value;
    if (values.length === 0) return [[dim(key), dim(Marks.none)]];
    return values.map((entry, index) => [index === 0 ? dim(key) : "", entry]);
  });
  return columns(rows);
};
