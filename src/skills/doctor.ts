import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isSymlink, pathPresent, symlinkTarget } from "./fsx.js";
import { loadManifest } from "./manifest.js";
import { loadOverlays } from "./overlays.js";
import { resolveRemoteSkills, selectorName } from "./remotes.js";
import { lockedSkillNames } from "./skill-lock.js";
import { listCommandNames, listSkillNames } from "./sync.js";
import { AllSurfaces } from "./types.js";
import type { Surface } from "./types.js";
import type { SkillPaths } from "./paths.js";

export interface DoctorEntry {
  label: string;
  detail: string;
  hint?: string;
}

export interface DoctorReport {
  sourceSkillCount: number;
  sourceCommandCount: number;
  issues: DoctorEntry[];
  notes: DoctorEntry[];
}

const hasRealSkillFile = (dir: string): boolean => {
  const skillFile = join(dir, "SKILL.md");
  return existsSync(skillFile) && !isSymlink(skillFile);
};

// Apply only writes the opencode and cursor surfaces when a skill needs a directory that
// only that client reads, so anything else living there belongs to someone else and is worth
// a note rather than a complaint.
const scanSurfaceLinks = (
  paths: SkillPaths,
  surface: Surface,
  report: DoctorReport,
): void => {
  const dir = paths.surfaceDirs[surface];
  if (dir === paths.sourceSkills || !existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      if (!existsSync(path)) report.issues.push({ label: "broken link", detail: path });
    } else if (entry.isDirectory()) {
      if (surface === "claude") {
        report.issues.push({
          label: "drift",
          detail: path,
          hint: "real directory, expected a link into .build/",
        });
      } else {
        report.notes.push({ label: "unmanaged", detail: path, hint: `${surface} surface` });
      }
    }
  }
};

const scanAgentsSkills = (paths: SkillPaths, report: DoctorReport): void => {
  const agentsSkills = paths.surfaceDirs.agents;
  if (!existsSync(agentsSkills)) return;
  const vendored = lockedSkillNames(paths.skillLockPath);
  for (const entry of readdirSync(agentsSkills, { withFileTypes: true })) {
    const path = join(agentsSkills, entry.name);
    if (entry.isSymbolicLink()) {
      if (!existsSync(path)) {
        report.issues.push({ label: "broken link", detail: path });
        continue;
      }
      const target = symlinkTarget(path) ?? "";
      const resolved = resolve(dirname(path), target);
      const managed = resolved === paths.buildDir || resolved.startsWith(paths.buildDir + sep);
      if (!managed) {
        report.notes.push({ label: "legacy link", detail: entry.name, hint: `-> ${target}` });
      }
    } else if (entry.isDirectory() && vendored.has(entry.name)) {
      report.notes.push({
        label: "externally managed",
        detail: entry.name,
        hint: "skill-lock",
      });
    } else if (entry.isDirectory() && hasRealSkillFile(path)) {
      report.notes.push({
        label: "untracked",
        detail: entry.name,
        hint: "run `skctl import`",
      });
    } else if (
      entry.isDirectory() &&
      existsSync(join(path, "SKILL.md")) &&
      lstatSync(join(path, "SKILL.md")).isSymbolicLink()
    ) {
      report.notes.push({
        label: "vendored",
        detail: entry.name,
        hint: "SKILL.md links outside the source repo",
      });
    }
  }
};

const scanOrphans = (paths: SkillPaths, report: DoctorReport): void => {
  const manifest = loadManifest(paths.manifestPath);
  const remotes = resolveRemoteSkills(paths, manifest);
  for (const problem of remotes.problems) {
    report.issues.push({ label: "remote", detail: problem.detail, hint: problem.note });
  }
  const skills = new Set([
    ...listSkillNames(paths.sourceSkills),
    ...remotes.skills.map((skill) => skill.name),
    // A remote selection may be path-qualified, so compare on the name a client would see.
    ...Object.values(manifest.remotes).flatMap((remote) => remote.skills.map(selectorName)),
  ]);
  const commands = new Set(listCommandNames(paths.sourceCommands));
  for (const name of Object.keys(manifest.skills)) {
    if (!skills.has(name)) report.issues.push({ label: "orphan skill entry", detail: name });
  }
  for (const name of Object.keys(manifest.commands)) {
    if (!commands.has(name)) {
      report.issues.push({ label: "orphan command entry", detail: name });
    }
  }
  for (const [alias, remote] of Object.entries(manifest.remotes)) {
    if (remote.skills.length === 0) {
      report.notes.push({
        label: "nothing selected",
        detail: alias,
        hint: "run `skctl browse` or `skctl remote remove`",
      });
    }
  }
  const { overlays, problems } = loadOverlays(paths);
  for (const problem of problems) {
    report.issues.push({ label: "overlay", detail: problem.detail, hint: problem.note });
  }
  for (const [name, overlay] of overlays) {
    if (!skills.has(name)) {
      report.issues.push({ label: "orphan overlay", detail: overlay.path, hint: `no skill '${name}'` });
    }
  }
};

const scanBuild = (paths: SkillPaths, report: DoctorReport): void => {
  const ignored =
    existsSync(paths.gitignorePath) &&
    readFileSync(paths.gitignorePath, "utf-8")
      .split(/\r?\n/)
      .some((line) => line.trim() === ".build/");
  if (!ignored) {
    report.issues.push({
      label: "build not ignored",
      detail: paths.gitignorePath,
      hint: "run `skctl apply` to add .build/",
    });
  }
};

const scanInstructions = (paths: SkillPaths, report: DoctorReport): void => {
  if (
    paths.instructionImports.length === 0 &&
    paths.instructionLinks.length === 0
  ) {
    return;
  }
  const importPaths = paths.instructionImports.filter(pathPresent);
  if (!existsSync(paths.instructionsSource)) {
    if (importPaths.length > 0) {
      report.notes.push({
        label: "untracked instructions",
        detail: paths.instructionsSource,
        hint: "run `skctl import instructions`",
      });
    }
    return;
  }
  const sourceContent = readFileSync(paths.instructionsSource, "utf-8");
  for (const path of importPaths) {
    if (!existsSync(path) || lstatSync(path).isDirectory()) {
      report.issues.push({ label: "unreadable home instructions", detail: path });
    } else if (readFileSync(path, "utf-8") === sourceContent) {
      report.issues.push({
        label: "duplicate home instructions",
        detail: path,
        hint: "run `skctl import instructions`",
      });
    } else {
      report.issues.push({ label: "conflicting home instructions", detail: path });
    }
  }
  for (const path of new Set(paths.instructionLinks)) {
    if (!pathPresent(path)) {
      report.issues.push({ label: "missing instruction link", detail: path });
      continue;
    }
    const expected = relative(dirname(path), paths.instructionsSource);
    if (!isSymlink(path) || symlinkTarget(path) !== expected) {
      report.issues.push({
        label: "drift",
        detail: path,
        hint: `does not link to ${paths.instructionsSource}`,
      });
    }
  }
};

export const doctor = (paths: SkillPaths): DoctorReport => {
  const report: DoctorReport = {
    sourceSkillCount: listSkillNames(paths.sourceSkills).length,
    sourceCommandCount: listCommandNames(paths.sourceCommands).length,
    issues: [],
    notes: [],
  };
  if (!existsSync(paths.sourceRepo)) {
    report.issues.push({ label: "source repo missing", detail: paths.sourceRepo });
    return report;
  }
  for (const surface of AllSurfaces) {
    if (surface !== "agents" || paths.scope !== "global") scanSurfaceLinks(paths, surface, report);
  }
  if (paths.scope === "global") scanAgentsSkills(paths, report);
  scanInstructions(paths, report);
  scanOrphans(paths, report);
  scanBuild(paths, report);
  return report;
};
