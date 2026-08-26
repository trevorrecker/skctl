import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ensureSymlink, isSymlink, moveDir } from "./fsx.js";
import { lockedSkillNames } from "./skill-lock.js";
import type { Action } from "./types.js";
import type { SkillPaths } from "./paths.js";

export interface ImportReport {
  dryRun: boolean;
  imported: string[];
  skipped: Action[];
}

const isImportable = (dir: string): boolean => {
  const skillFile = join(dir, "SKILL.md");
  return existsSync(skillFile) && !isSymlink(skillFile);
};

export const importLooseSkills = (
  paths: SkillPaths,
  dryRun: boolean,
): ImportReport => {
  const report: ImportReport = { dryRun, imported: [], skipped: [] };
  if (!existsSync(paths.surfaceDirs.agents)) return report;

  const vendored = lockedSkillNames(paths.skillLockPath);

  for (const entry of readdirSync(paths.surfaceDirs.agents, { withFileTypes: true })) {
    const name = entry.name;
    const agentsPath = join(paths.surfaceDirs.agents, name);
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    if (vendored.has(name)) {
      report.skipped.push({
        kind: "ok",
        detail: `${name}: externally managed (skill-lock), left in place`,
      });
      continue;
    }
    if (!isImportable(agentsPath)) {
      report.skipped.push({
        kind: "conflict",
        detail: `${name}: not a self-contained skill (SKILL.md missing or linked)`,
      });
      continue;
    }

    const dest = join(paths.sourceSkills, name);
    if (existsSync(dest)) {
      report.skipped.push({
        kind: "conflict",
        detail: `${name}: already present in source repo`,
      });
      continue;
    }

    if (!dryRun) {
      moveDir(agentsPath, dest);
      ensureSymlink(agentsPath, dest, false);
    }
    report.imported.push(name);
  }

  return report;
};
