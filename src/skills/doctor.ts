import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isSymlink, symlinkTarget } from "./fsx.js";
import { loadManifest } from "./manifest.js";
import { resolveRemoteSkills } from "./remotes.js";
import { listCommandNames, listSkillNames } from "./sync.js";
import type { SkillPaths } from "./paths.js";

const externallyManaged = (skillLockPath: string): Set<string> => {
  if (!existsSync(skillLockPath)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(skillLockPath, "utf-8")) as {
      skills?: Record<string, unknown>;
    };
    return new Set(Object.keys(parsed.skills ?? {}));
  } catch {
    return new Set();
  }
};

export interface DoctorReport {
  sourceSkillCount: number;
  sourceCommandCount: number;
  issues: string[];
  notes: string[];
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
      if (!existsSync(path)) report.issues.push(`broken link: ${path}`);
    } else if (entry.isDirectory()) {
      report.issues.push(
        `drift: ${path} is a real directory, expected a symlink into ~/.agents/skills`,
      );
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
        report.issues.push(`broken link: ${path}`);
        continue;
      }
      const target = symlinkTarget(path) ?? "";
      if (
        !target.includes("dev/skills/skills") &&
        !target.includes("dev/skills/remotes")
      ) {
        report.notes.push(`legacy link: ${entry.name} -> ${target}`);
      }
    } else if (entry.isDirectory() && vendored.has(entry.name)) {
      report.notes.push(`externally managed: ${entry.name} (skill-lock)`);
    } else if (entry.isDirectory() && hasRealSkillFile(path)) {
      report.notes.push(`untracked: ${entry.name} (run \`skctl import\`)`);
    } else if (
      entry.isDirectory() &&
      existsSync(join(path, "SKILL.md")) &&
      lstatSync(join(path, "SKILL.md")).isSymbolicLink()
    ) {
      report.notes.push(`vendored: ${entry.name} (SKILL.md links outside the source repo)`);
    }
  }
};

const scanOrphans = (paths: SkillPaths, report: DoctorReport): void => {
  const manifest = loadManifest(paths.manifestPath);
  const remotes = resolveRemoteSkills(paths, manifest);
  for (const problem of remotes.problems) report.issues.push(problem.detail);
  const skills = new Set([
    ...listSkillNames(paths.sourceSkills),
    ...remotes.skills.map((skill) => skill.name),
    ...Object.values(manifest.remotes).flatMap((remote) => remote.skills),
  ]);
  const commands = new Set(listCommandNames(paths.sourceCommands));
  for (const name of Object.keys(manifest.skills)) {
    if (!skills.has(name)) report.issues.push(`orphan manifest skill: ${name}`);
  }
  for (const name of Object.keys(manifest.commands)) {
    if (!commands.has(name)) report.issues.push(`orphan manifest command: ${name}`);
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
    report.issues.push(`source repo missing: ${paths.sourceRepo}`);
    return report;
  }
  scanClaudeSkills(paths, report);
  if (paths.scope === "global") scanAgentsSkills(paths, report);
  scanOrphans(paths, report);
  return report;
};
