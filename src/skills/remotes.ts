import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
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
  available: string[];
  cloned: boolean;
  head?: string;
}

export interface AddRemoteResult {
  alias: string;
  action: Action;
  manifest: SkillsManifest;
  available: string[];
  selected: string[];
}

export interface ManifestChange {
  action: Action;
  manifest: SkillsManifest;
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

export const remoteAlias = (url: string): string => {
  const trimmed = url.replace(/\/+$/, "").replace(/\.git$/, "");
  const tail = trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf(":")) + 1);
  return tail.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
};

export const discoverRemoteSkills = (clonePath: string): string[] =>
  [...new Set(findSkillDirs(clonePath).map(dir => basename(dir)))].sort();

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
        subject: alias,
        detail: `remote '${alias}' not cloned`,
        note: "run `skctl pull`",
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
          subject: name,
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

export const updateRoot = (paths: SkillPaths): Action => {
  try {
    const dirty = git(["-C", paths.sourceRepo, "status", "--porcelain"]);
    if (dirty !== "") {
      return {
        kind: "conflict",
        subject: "root",
        detail: "working tree has changes",
      };
    }
    git([
      "-C",
      paths.sourceRepo,
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    const before = git(["-C", paths.sourceRepo, "rev-parse", "HEAD"]);
    git(["-C", paths.sourceRepo, "pull", "--ff-only", "--quiet"]);
    const after = git(["-C", paths.sourceRepo, "rev-parse", "HEAD"]);
    return before === after
      ? { kind: "ok", subject: "root", detail: `up to date (${after.slice(0, 7)})` }
      : {
          kind: "replaced",
          subject: "root",
          detail: `${before.slice(0, 7)} -> ${after.slice(0, 7)}`,
        };
  } catch (error) {
    const message = error instanceof Error ? error.message : `${error}`;
    return { kind: "conflict", subject: "root", detail: "git failed", note: message };
  }
};

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
    return {
      alias,
      url: remote.url,
      skills: remote.skills,
      available: cloned ? discoverRemoteSkills(clonePath) : [],
      cloned,
      head,
    };
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
    return [{ kind: "conflict", subject: alias, detail: "unknown remote" }];
  }
  return entries.map(([name, remote]) => {
    const clonePath = join(paths.remotesDir, name);
    try {
      if (!existsSync(clonePath)) {
        mkdirSync(paths.remotesDir, { recursive: true });
        git(["clone", "--quiet", remote.url, clonePath]);
        return { kind: "created", subject: name, detail: `cloned ${remote.url}` };
      }
      const before = git(["-C", clonePath, "rev-parse", "HEAD"]);
      git(["-C", clonePath, "pull", "--ff-only", "--quiet"]);
      const after = git(["-C", clonePath, "rev-parse", "HEAD"]);
      return before === after
        ? { kind: "ok", subject: name, detail: `up to date (${after.slice(0, 7)})` }
        : {
            kind: "replaced",
            subject: name,
            detail: `${before.slice(0, 7)} -> ${after.slice(0, 7)}`,
          };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "conflict", subject: name, detail: "git failed", note: message };
    }
  });
};

const failedAdd = (
  alias: string,
  manifest: SkillsManifest,
  detail: string,
  note?: string,
): AddRemoteResult => ({
  alias,
  action: { kind: "conflict", subject: alias, detail, note },
  manifest,
  available: [],
  selected: [],
});

export const addRemote = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  url: string,
  options: { alias?: string; skills?: string[]; force?: boolean } = {},
): AddRemoteResult => {
  const alias = options.alias ?? remoteAlias(url);
  if (alias === "") {
    return failedAdd(url, manifest, "cannot derive an alias from the url", "pass one explicitly");
  }
  const existing = manifest.remotes[alias];
  if (existing !== undefined && existing.url !== url && options.force !== true) {
    return failedAdd(
      alias,
      manifest,
      `alias already tracks ${existing.url}`,
      "pass a different alias or --force",
    );
  }

  const clonePath = join(paths.remotesDir, alias);
  const reusedClone = existsSync(clonePath);
  let action: Action;
  try {
    if (reusedClone) {
      action = { kind: "ok", subject: alias, detail: "already cloned" };
    } else {
      mkdirSync(paths.remotesDir, { recursive: true });
      git(["clone", "--quiet", url, clonePath]);
      action = { kind: "created", subject: alias, detail: `cloned ${url}` };
    }
  } catch (error) {
    if (!reusedClone) rmSync(clonePath, { recursive: true, force: true });
    return failedAdd(
      alias,
      manifest,
      "clone failed",
      error instanceof Error ? error.message : String(error),
    );
  }

  // A clone this call created is worthless without a manifest entry, so any
  // later failure has to take it back down.
  const abandon = (detail: string, note?: string): AddRemoteResult => {
    if (!reusedClone) rmSync(clonePath, { recursive: true, force: true });
    return failedAdd(alias, manifest, detail, note);
  };

  const available = discoverRemoteSkills(clonePath);
  if (available.length === 0) {
    return abandon("no SKILL.md found in the repository");
  }
  const unknown = (options.skills ?? []).filter(name => !available.includes(name));
  if (unknown.length > 0) {
    return abandon(`no skill named ${unknown.join(", ")}`, `available: ${available.join(", ")}`);
  }
  const selected = options.skills ?? available;

  return {
    alias,
    action,
    available,
    selected,
    manifest: {
      ...manifest,
      remotes: { ...manifest.remotes, [alias]: { url, skills: selected } },
    },
  };
};

export const removeRemote = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  alias: string,
  dryRun: boolean,
): ManifestChange => {
  const remote = manifest.remotes[alias];
  if (remote === undefined) {
    return {
      action: { kind: "conflict", subject: alias, detail: "unknown remote" },
      manifest,
    };
  }
  const clonePath = join(paths.remotesDir, alias);
  if (!dryRun && existsSync(clonePath)) {
    rmSync(clonePath, { recursive: true, force: true });
  }
  const remotes = { ...manifest.remotes };
  delete remotes[alias];
  const stillSupplied = new Set(
    Object.values(remotes).flatMap(entry => entry.skills),
  );
  const skills = Object.fromEntries(
    Object.entries(manifest.skills).filter(
      ([name]) =>
        !remote.skills.includes(name) ||
        stillSupplied.has(name) ||
        existsSync(join(paths.sourceSkills, name, "SKILL.md")),
    ),
  );
  return {
    action: {
      kind: "removed",
      subject: alias,
      detail: clonePath,
      note: `dropped ${remote.skills.length} skill selection(s)`,
    },
    manifest: { ...manifest, remotes, skills },
  };
};

export const detachRemoteSkill = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  name: string,
  dryRun: boolean,
): ManifestChange => {
  const suppliers = Object.entries(manifest.remotes).filter(
    ([, remote]) => remote.skills.includes(name),
  );
  if (suppliers.length === 0) {
    return {
      action: { kind: "conflict", subject: name, detail: "no active remote skill found" },
      manifest,
    };
  }
  if (suppliers.length > 1) {
    return {
      action: { kind: "conflict", subject: name, detail: "supplied by more than one remote" },
      manifest,
    };
  }

  const skill = resolveRemoteSkills(paths, manifest).skills.find(
    remoteSkill => remoteSkill.name === name && remoteSkill.remote === suppliers[0][0],
  );
  if (skill === undefined) {
    return {
      action: { kind: "conflict", subject: name, detail: "remote skill is not available on disk" },
      manifest,
    };
  }
  const destination = join(paths.sourceSkills, name);
  if (existsSync(destination)) {
    return {
      action: { kind: "conflict", subject: name, detail: "local skill already exists" },
      manifest,
    };
  }

  const remote = manifest.remotes[skill.remote];
  if (remote === undefined) {
    return {
      action: { kind: "conflict", subject: name, detail: `remote '${skill.remote}' is not configured` },
      manifest,
    };
  }
  if (!dryRun) {
    mkdirSync(paths.sourceSkills, { recursive: true });
    cpSync(skill.sourceDir, destination, { recursive: true });
  }

  return {
    action: {
      kind: "created",
      subject: name,
      detail: destination,
      note: `detached from '${skill.remote}'`,
    },
    manifest: {
      ...manifest,
      remotes: {
        ...manifest.remotes,
        [skill.remote]: {
          ...remote,
          skills: remote.skills.filter(remoteSkill => remoteSkill !== name),
        },
      },
    },
  };
};
