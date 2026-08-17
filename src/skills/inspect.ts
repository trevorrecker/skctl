import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import { loadManifest, resolveEntry } from "./manifest.js";
import { resolveRemoteSkills } from "./remotes.js";
import { listCommandNames, listSkillNames } from "./sync.js";
import type { Host, SkillsManifest } from "./types.js";
import type { SkillPaths } from "./paths.js";

export interface SkillInfo {
  name: string;
  enabled: boolean;
  hosts: Host[];
  tags: string[];
  paste: boolean;
  description: string;
  remote?: string;
  path: string;
}

export interface CommandInfo {
  name: string;
  enabled: boolean;
  hosts: Host[];
  description: string;
  path: string;
}

const skillMarkdownPath = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  name: string,
): string => {
  const local = join(paths.sourceSkills, name, "SKILL.md");
  if (existsSync(local)) return local;
  const match = resolveRemoteSkills(paths, manifest).skills.find(
    (skill) => skill.name === name,
  );
  return match ? join(match.sourceDir, "SKILL.md") : local;
};

const stripFrontmatter = (file: string): string => {
  const lines = file.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return file.trim();
  const close = lines.indexOf("---", 1);
  return close === -1 ? file.trim() : lines.slice(close + 1).join("\n").trim();
};

const readFrontmatter = (path: string): Record<string, unknown> => {
  if (!existsSync(path)) return {};
  try {
    return parseFrontmatter(readFileSync(path, "utf-8")).data;
  } catch {
    return {};
  }
};

const readContent = (path: string, raw: boolean): string => {
  if (!existsSync(path)) throw new Error(`unknown: ${path}`);
  const file = readFileSync(path, "utf-8");
  if (raw) return file;
  try {
    return parseFrontmatter(file).content.trim();
  } catch {
    return stripFrontmatter(file);
  }
};

export const skillInfo = (
  paths: SkillPaths,
  name: string,
  remote?: string,
  activeTags: readonly string[] = [],
): SkillInfo => {
  const manifest = loadManifest(paths.manifestPath);
  const resolved = resolveEntry(name, manifest.skills[name], manifest, activeTags);
  const path = skillMarkdownPath(paths, manifest, name);
  const data = readFrontmatter(path);
  return {
    name,
    enabled: resolved.enabled,
    hosts: resolved.hosts,
    tags: resolved.tags,
    paste: data.paste === true,
    description: typeof data.description === "string" ? data.description : "",
    remote,
    path,
  };
};

export const listSkills = (
  paths: SkillPaths,
  onlyPaste = false,
  activeTags: readonly string[] = [],
): SkillInfo[] => {
  const manifest = loadManifest(paths.manifestPath);
  const localNames = listSkillNames(paths.sourceSkills);
  const localSet = new Set(localNames);
  const remoteSkills = resolveRemoteSkills(paths, manifest)
    .skills.filter((skill) => !localSet.has(skill.name))
    .map(skill => skillInfo(paths, skill.name, skill.remote, activeTags));
  return [
    ...localNames.map(name => skillInfo(paths, name, undefined, activeTags)),
    ...remoteSkills,
  ]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((info) => !onlyPaste || info.paste);
};

export const skillContent = (
  paths: SkillPaths,
  name: string,
  raw: boolean,
): string => {
  const path = skillMarkdownPath(paths, loadManifest(paths.manifestPath), name);
  if (!existsSync(path)) throw new Error(`unknown skill: ${name}`);
  return readContent(path, raw);
};

export const commandInfo = (paths: SkillPaths, name: string): CommandInfo => {
  const manifest = loadManifest(paths.manifestPath);
  const resolved = resolveEntry(name, manifest.commands[name], manifest);
  const path = join(paths.sourceCommands, `${name}.md`);
  const data = readFrontmatter(path);
  return {
    name,
    enabled: resolved.enabled,
    hosts: resolved.hosts,
    description: typeof data.description === "string" ? data.description : "",
    path,
  };
};

export const listCommands = (paths: SkillPaths): CommandInfo[] =>
  listCommandNames(paths.sourceCommands).map((name) => commandInfo(paths, name));

export const commandContent = (
  paths: SkillPaths,
  name: string,
  raw: boolean,
): string => {
  const path = join(paths.sourceCommands, `${name}.md`);
  if (!existsSync(path)) throw new Error(`unknown command: ${name}`);
  return readContent(path, raw);
};
