import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { divergentBodies, planSkillBuild, pruneBuild, writeSkillBuild } from "./build.js";
import { ensureSymlink, pathPresent, symlinkTarget } from "./fsx.js";
import { loadManifest } from "./manifest.js";
import { loadOverlays } from "./overlays.js";
import { ProjectConfigName } from "./paths.js";
import { resolveRemoteSkills } from "./remotes.js";
import { listSkillNames } from "./sync.js";
import { AllSurfaces } from "./types.js";
import { isRecord } from "../record.js";
import type { Action, SkillsManifest, Surface } from "./types.js";
import type { ProjectTarget, SkillPaths } from "./paths.js";

export type ProjectMode = "link" | "copy";

export interface ProjectConfig {
  from: string;
  tags: string[];
  skills: string[];
  mode: ProjectMode;
  // Copy mode leaves real directories behind, which say nothing about who wrote them, so the
  // list is recorded here. Link mode needs no equivalent: a link into the build describes
  // itself, and reconcile reads it back.
  written?: string[];
}

export interface ProjectReport {
  config: ProjectConfig;
  selected: string[];
  actions: Action[];
}

interface Candidate {
  name: string;
  sourceDir: string;
}

interface CandidateCatalog {
  candidates: Candidate[];
  problems: Action[];
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const loadProjectConfig = (target: ProjectTarget): ProjectConfig | undefined => {
  if (!existsSync(target.configPath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(target.configPath, "utf-8"));
    if (!isRecord(parsed) || typeof parsed.from !== "string") return undefined;
    return {
      from: parsed.from,
      tags: strings(parsed.tags),
      skills: strings(parsed.skills),
      mode: parsed.mode === "copy" ? "copy" : "link",
      written: Array.isArray(parsed.written) ? strings(parsed.written) : undefined,
    };
  } catch {
    return undefined;
  }
};

export const saveProjectConfig = (
  target: ProjectTarget,
  config: ProjectConfig,
): void => {
  mkdirSync(dirname(target.configPath), { recursive: true });
  writeFileSync(target.configPath, `${JSON.stringify(config, undefined, 2)}\n`, "utf-8");
};

const candidateCatalog = (paths: SkillPaths, manifest: SkillsManifest): CandidateCatalog => {
  const local = listSkillNames(paths.sourceSkills).map((name) => ({
    name,
    sourceDir: join(paths.sourceSkills, name),
  }));
  const taken = new Set(local.map((entry) => entry.name));
  const remote = resolveRemoteSkills(paths, manifest);
  const problems = [...remote.problems];
  const byName = new Map<string, typeof remote.skills>();
  for (const skill of remote.skills) {
    byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
  }
  const remoteCandidates: Candidate[] = [];
  for (const [name, matches] of byName) {
    if (taken.has(name)) {
      problems.push({
        kind: "conflict",
        subject: name,
        detail: "local skill shadows a selected remote skill",
      });
      continue;
    }
    if (matches.length > 1) {
      problems.push({
        kind: "conflict",
        subject: name,
        detail: `${matches.length} selected remote skills are named '${name}'`,
        note: matches.map((match) => match.path).join(", "),
      });
      continue;
    }
    const match = matches[0];
    if (match !== undefined) remoteCandidates.push({ name, sourceDir: match.sourceDir });
  }
  return {
    candidates: [...local, ...remoteCandidates].sort(
      (left, right) => left.name.localeCompare(right.name),
    ),
    problems,
  };
};

const selectCandidates = (
  candidates: readonly Candidate[],
  manifest: SkillsManifest,
  config: ProjectConfig,
): Candidate[] => {
  const wanted = new Set(config.skills);
  const tags = new Set(config.tags);
  return candidates.filter((candidate) => {
    if (manifest.skills[candidate.name]?.enabled === false) return false;
    if (wanted.has(candidate.name)) return true;
    const entry = manifest.skills[candidate.name];
    return (entry?.tags ?? []).some((tag) => tags.has(tag));
  });
};

export const selectForProject = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  config: ProjectConfig,
): Candidate[] => {
  const catalog = candidateCatalog(paths, manifest);
  return selectCandidates(catalog.candidates, manifest, config);
};

const withinBuild = (link: string, buildDir: string): boolean => {
  const target = symlinkTarget(link);
  if (target === undefined) return false;
  const resolved = resolve(dirname(link), target);
  return resolved === buildDir || resolved.startsWith(buildDir + sep);
};

// Link mode reconciles by reading the links back, so anything pointing into a build directory
// that is not in the current selection goes. Copy mode has nothing to read, so it works from
// the recorded list instead.
const pruneLinks = (
  target: ProjectTarget,
  keep: Set<string>,
  dryRun: boolean,
): Action[] => {
  const actions: Action[] = [];
  for (const surface of AllSurfaces) {
    const dir = target.surfaceDirs[surface];
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const link = join(dir, entry.name);
      if (keep.has(link) || !entry.isSymbolicLink()) continue;
      if (!withinBuild(link, target.buildDir)) continue;
      if (!dryRun) rmSync(link);
      actions.push({ kind: "removed", detail: link, subject: entry.name, note: "deselected" });
    }
  }
  return actions;
};

const pruneCopies = (
  target: ProjectTarget,
  written: readonly string[],
  keep: Set<string>,
  dryRun: boolean,
): Action[] =>
  written.flatMap((relativePath): Action[] => {
    const name = basename(relativePath);
    if (keep.has(relativePath)) return [];
    const path = resolve(target.root, relativePath);
    const managed = AllSurfaces.some(
      (surface) => dirname(path) === resolve(target.surfaceDirs[surface]),
    );
    if (!managed) {
      return [{
        kind: "conflict",
        detail: relativePath,
        subject: name,
        note: "project config names a path outside a managed skill directory",
      }];
    }
    if (!pathPresent(path)) return [];
    if (!dryRun) rmSync(path, { recursive: true, force: true });
    return [{ kind: "removed", detail: path, subject: name, note: "deselected" }];
  });

const copyInto = (
  dest: string,
  sourceDir: string,
  dryRun: boolean,
  managed: boolean,
): Action => {
  const exists = pathPresent(dest);
  if (exists && !managed) {
    return { kind: "conflict", detail: dest, note: "exists and was not written by skctl" };
  }
  if (!dryRun) {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(sourceDir, dest, { recursive: true, dereference: true });
  }
  return { kind: exists ? "replaced" : "created", detail: dest };
};

const projectIgnoreEntries = [".agents/.build/", `.agents/${ProjectConfigName}`];

const ensureProjectIgnored = (target: ProjectTarget, dryRun: boolean): Action => {
  const current = existsSync(target.gitignorePath)
    ? readFileSync(target.gitignorePath, "utf-8")
    : "";
  const currentEntries = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = projectIgnoreEntries.filter((entry) => !currentEntries.has(entry));
  if (missing.length === 0) {
    return { kind: "ok", subject: ".gitignore", detail: target.gitignorePath };
  }
  const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
  if (!dryRun) {
    mkdirSync(dirname(target.gitignorePath), { recursive: true });
    writeFileSync(
      target.gitignorePath,
      `${prefix}${current === "" ? "" : "\n"}${missing.join("\n")}\n`,
      "utf-8",
    );
  }
  return {
    kind: current === "" ? "created" : "replaced",
    subject: ".gitignore",
    detail: target.gitignorePath,
    note: `ignored ${missing.join(", ")}`,
  };
};

export const reconcileProject = (
  paths: SkillPaths,
  target: ProjectTarget,
  config: ProjectConfig,
  dryRun: boolean,
): ProjectReport => {
  const manifest = loadManifest(paths.manifestPath);
  const { overlays, problems } = loadOverlays(paths);
  const catalog = candidateCatalog(paths, manifest);
  const selected = selectCandidates(catalog.candidates, manifest, config);
  const available = new Set(catalog.candidates.map((candidate) => candidate.name));
  const unavailable = config.skills
    .filter((name) => !available.has(name))
    .map((name): Action => ({
      kind: "conflict",
      subject: name,
      detail: "selected skill is not available",
    }));
  const keep = new Set(selected.map((candidate) => candidate.name));
  const actions: Action[] = [
    ...problems,
    ...catalog.problems,
    ...unavailable,
    ensureProjectIgnored(target, dryRun),
  ];
  const built = new Map<Surface, Set<string>>();
  const links = new Set<string>();
  const written: string[] = [];
  const previouslyWritten = new Set(config.written ?? []);

  for (const candidate of selected) {
    const hosts = manifest.skills[candidate.name]?.hosts ?? manifest.defaultHosts;
    const build = planSkillBuild(
      candidate.name,
      candidate.sourceDir,
      hosts,
      overlays.get(candidate.name),
    );
    actions.push(
      ...writeSkillBuild(target.buildDir, build, candidate.sourceDir, dryRun).map((action) => ({
        ...action,
        subject: candidate.name,
      })),
      ...divergentBodies(build),
    );
    for (const surface of build.surfaces) {
      built.set(surface, (built.get(surface) ?? new Set()).add(candidate.name));
      const dest = join(target.surfaceDirs[surface], candidate.name);
      const source = join(target.buildDir, surface, candidate.name);
      const relativeDest = relative(target.root, dest).split(sep).join("/");
      links.add(dest);
      const action = {
        ...(config.mode === "copy"
          ? copyInto(dest, source, dryRun, previouslyWritten.has(relativeDest))
          : ensureSymlink(dest, source, dryRun)),
        subject: candidate.name,
      };
      actions.push(action);
      if (config.mode === "copy" && action.kind !== "conflict") written.push(relativeDest);
    }
  }

  actions.push(
    ...(config.mode === "copy"
      ? pruneCopies(target, config.written ?? [], new Set(written), dryRun)
      : pruneLinks(target, links, dryRun)),
    ...pruneBuild(target.buildDir, built, dryRun),
  );
  // Copy mode keeps its build only as a staging area; leaving it behind would look like the
  // committed copies were links into something.
  if (config.mode === "copy" && !dryRun && existsSync(target.buildDir)) {
    rmSync(target.buildDir, { recursive: true, force: true });
  }

  return {
    config: config.mode === "copy" ? { ...config, written: [...new Set(written)].sort() } : config,
    selected: [...keep].sort(),
    actions,
  };
};

export const removeProject = (
  target: ProjectTarget,
  config: ProjectConfig,
  dryRun: boolean,
): Action[] => {
  const actions =
    config.mode === "copy"
      ? pruneCopies(target, config.written ?? [], new Set(), dryRun)
      : pruneLinks(target, new Set(), dryRun);
  if (existsSync(target.buildDir)) {
    if (!dryRun) rmSync(target.buildDir, { recursive: true, force: true });
    actions.push({ kind: "removed", detail: target.buildDir, subject: ".build" });
  }
  if (existsSync(target.configPath)) {
    if (!dryRun) rmSync(target.configPath);
    actions.push({ kind: "removed", detail: target.configPath, subject: ProjectConfigName });
  }
  return actions;
};
