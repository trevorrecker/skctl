import { parse, stringify } from "yaml";

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

const fence = "---";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseFrontmatter = (source: string): ParsedFrontmatter => {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== fence) return { data: {}, content: text };
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === fence);
  if (close === -1) return { data: {}, content: text };
  const parsed: unknown = parse(lines.slice(1, close).join("\n"));
  return {
    data: isRecord(parsed) ? parsed : {},
    content: lines.slice(close + 1).join("\n"),
  };
};

export const stringifyFrontmatter = (
  content: string,
  data: Record<string, unknown>,
): string => {
  const entries = Object.entries(data).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return content;
  // Hosts read these files as much as skctl does, so keep every value on one line
  // rather than letting long descriptions fold into block scalars.
  const block = stringify(Object.fromEntries(entries), { lineWidth: 0 });
  return `${fence}\n${block}${fence}\n${content}`;
};
