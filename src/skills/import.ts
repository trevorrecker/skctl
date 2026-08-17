import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ensureSymlink, isSymlink, moveDir } from "./fsx.js";
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

export const importLooseSkills = (
  paths: SkillPaths,
  dryRun: boolean,
): ImportReport => {
  const report: ImportReport = { dryRun, imported: [], skipped: [] };
  if (!existsSync(paths.agentsSkills)) return report;

  const vendored = externallyManaged(paths.skillLockPath);

  for (const entry of readdirSync(paths.agentsSkills, { withFileTypes: true })) {
    const name = entry.name;
    const agentsPath = join(paths.agentsSkills, name);
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
