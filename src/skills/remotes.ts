import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Action, SkillsManifest } from "./types.js";
import type { SkillPaths } from "./paths.js";

export interface RemoteSkill {
  name: string;
  remote: string;
  sourceDir: string;
}

export interface RemoteResolution {
  skills: RemoteSkill[];
  problems: Action[];
}

export interface RemoteInfo {
  alias: string;
  url: string;
  skills: string[];
  cloned: boolean;
  head?: string;
}

const skippedDirs = new Set(["node_modules", "dist"]);

const findSkillDirs = (root: string, depth = 6): string[] => {
  if (depth === 0 || !existsSync(root)) return [];
  const dirs: string[] = [];
  if (existsSync(join(root, "SKILL.md"))) dirs.push(root);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || skippedDirs.has(entry.name)) continue;
    dirs.push(...findSkillDirs(join(root, entry.name), depth - 1));
  }
  return dirs;
};

export const resolveRemoteSkills = (
  paths: SkillPaths,
  manifest: SkillsManifest,
): RemoteResolution => {
  const resolution: RemoteResolution = { skills: [], problems: [] };
  for (const [alias, remote] of Object.entries(manifest.remotes)) {
    const clonePath = join(paths.remotesDir, alias);
    if (!existsSync(clonePath)) {
      resolution.problems.push({
        kind: "conflict",
        detail: `remote '${alias}' not cloned — run \`skctl pull\``,
      });
      continue;
    }
    const byName = new Map<string, string[]>();
    for (const dir of findSkillDirs(clonePath)) {
      const name = dir.slice(dir.lastIndexOf("/") + 1);
      byName.set(name, [...(byName.get(name) ?? []), dir]);
    }
    for (const name of remote.skills) {
      const found = byName.get(name) ?? [];
      if (found.length === 1) {
        resolution.skills.push({ name, remote: alias, sourceDir: found[0] });
      } else {
        resolution.problems.push({
          kind: "conflict",
          detail:
            found.length === 0
              ? `remote '${alias}' has no skill '${name}'`
              : `remote '${alias}' has ${found.length} dirs named '${name}'`,
        });
      }
    }
  }
  return resolution;
};

const git = (args: string[]): string =>
  execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export const listRemotes = (
  paths: SkillPaths,
  manifest: SkillsManifest,
): RemoteInfo[] =>
  Object.entries(manifest.remotes).map(([alias, remote]) => {
    const clonePath = join(paths.remotesDir, alias);
    const cloned = existsSync(clonePath);
    let head: string | undefined;
    if (cloned) {
      try {
        head = git(["-C", clonePath, "rev-parse", "--short", "HEAD"]);
      } catch {
        head = undefined;
      }
    }
    return { alias, url: remote.url, skills: remote.skills, cloned, head };
  });

export const updateRemotes = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  alias?: string,
): Action[] => {
  const entries = Object.entries(manifest.remotes).filter(
    ([name]) => alias === undefined || name === alias,
  );
  if (alias !== undefined && entries.length === 0) {
    return [{ kind: "conflict", detail: `unknown remote '${alias}'` }];
  }
  return entries.map(([name, remote]) => {
    const clonePath = join(paths.remotesDir, name);
    try {
      if (!existsSync(clonePath)) {
        mkdirSync(paths.remotesDir, { recursive: true });
        git(["clone", "--quiet", remote.url, clonePath]);
        return { kind: "created", detail: `${name}: cloned ${remote.url}` };
      }
      const before = git(["-C", clonePath, "rev-parse", "HEAD"]);
      git(["-C", clonePath, "pull", "--ff-only", "--quiet"]);
      const after = git(["-C", clonePath, "rev-parse", "HEAD"]);
      return before === after
        ? { kind: "ok", detail: `${name}: up to date (${after.slice(0, 7)})` }
        : {
            kind: "replaced",
            detail: `${name}: ${before.slice(0, 7)} -> ${after.slice(0, 7)}`,
          };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "conflict", detail: `${name}: git failed — ${message}` };
    }
  });
};
