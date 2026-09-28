import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { builtinOwner } from "./builtins.js";
import { ensureSymlink, isSymlink, moveDir } from "./fsx.js";
import { lockedSkillNames } from "./skill-lock.js";
import type { Action, SkillsManifest } from "./types.js";
import type { SkillPaths } from "./paths.js";

export interface ImportOptions {
  dryRun: boolean;
  // Import these even though a host ships them or they were ejected.
  adopt?: ReadonlySet<string>;
  // Leave these in place and record them as ejected so no machine imports them.
  skip?: ReadonlySet<string>;
}

export interface ImportReport {
  dryRun: boolean;
  imported: string[];
  skipped: Action[];
  // Newly recorded as ejected through `skip`.
  ejected: string[];
}

const isImportable = (dir: string): boolean => {
  const skillFile = join(dir, "SKILL.md");
  return existsSync(skillFile) && !isSymlink(skillFile);
};

export const importLooseSkills = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  { dryRun, adopt = new Set(), skip = new Set() }: ImportOptions,
): ImportReport => {
  const report: ImportReport = { dryRun, imported: [], skipped: [], ejected: [] };
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
    if (skip.has(name)) {
      report.skipped.push({ kind: "ok", detail: `${name}: skipped, left in place` });
      continue;
    }
    if (!adopt.has(name)) {
      if (manifest.ejected.includes(name)) {
        report.skipped.push({
          kind: "ok",
          detail: `${name}: ejected, left in place`,
          note: "--adopt to manage it again",
        });
        continue;
      }
      const owner = builtinOwner(paths, name, agentsPath);
      if (owner !== undefined) {
        report.skipped.push({
          kind: "ok",
          detail: `${name}: ${owner.reason}, left in place`,
          note: "--adopt to import it anyway",
        });
        continue;
      }
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

  // Recorded even when nothing by that name is loose here, so an import on another machine
  // leaves it alone too.
  report.ejected = [...skip].filter((name) => !manifest.ejected.includes(name));
  return report;
};
