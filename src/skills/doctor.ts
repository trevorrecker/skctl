import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isSymlink, pathPresent, symlinkTarget } from "./fsx.js";
import { loadManifest } from "./manifest.js";
import { resolveRemoteSkills } from "./remotes.js";
import { listCommandNames, listSkillNames } from "./sync.js";
import type { SkillPaths } from "./paths.js";

const externallyManaged = (skillLockPath: string): Set<string> => {
  if (!existsSync(skillLockPath)) return new Set();
  try {
    // SAFETY: only `skills` is read, and it is defaulted before use. Any other shape,
    // including a non-object, throws into the catch below and yields an empty set.
    const parsed = JSON.parse(readFileSync(skillLockPath, "utf-8")) as {
      skills?: Record<string, unknown>;
    };
    return new Set(Object.keys(parsed.skills ?? {}));
  } catch {
    return new Set();
  }
};

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

const scanClaudeSkills = (paths: SkillPaths, report: DoctorReport): void => {
  if (!existsSync(paths.claudeSkills)) return;
  for (const entry of readdirSync(paths.claudeSkills, { withFileTypes: true })) {
    const path = join(paths.claudeSkills, entry.name);
    if (entry.isSymbolicLink()) {
      if (!existsSync(path)) report.issues.push({ label: "broken link", detail: path });
    } else if (entry.isDirectory()) {
      report.issues.push({
        label: "drift",
        detail: path,
        hint: "real directory, expected a symlink into ~/.agents/skills",
      });
    }
  }
};

const scanAgentsSkills = (paths: SkillPaths, report: DoctorReport): void => {
  if (!existsSync(paths.agentsSkills)) return;
  const vendored = externallyManaged(paths.skillLockPath);
  for (const entry of readdirSync(paths.agentsSkills, { withFileTypes: true })) {
    const path = join(paths.agentsSkills, entry.name);
    if (entry.isSymbolicLink()) {
      if (!existsSync(path)) {
        report.issues.push({ label: "broken link", detail: path });
        continue;
      }
      const target = symlinkTarget(path) ?? "";
      const resolved = resolve(dirname(path), target);
      const managed = [paths.sourceSkills, paths.remotesDir].some(
        dir => resolved === dir || resolved.startsWith(dir + sep),
      );
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
    ...Object.values(manifest.remotes).flatMap((remote) => remote.skills),
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
  scanClaudeSkills(paths, report);
  if (paths.scope === "global") scanAgentsSkills(paths, report);
  scanInstructions(paths, report);
  scanOrphans(paths, report);
  return report;
};
