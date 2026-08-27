import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importLooseSkills } from "./import.js";
import { resolveSkillPaths } from "./paths.js";

const fixture = () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-import-"));
  return resolveSkillPaths(home, join(home, "root"));
};

const writeSkill = (dir: string, name: string): string => {
  const skillDir = join(dir, name);
  mkdirSync(join(skillDir, "scripts"), { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${name}\n---\n\nbody\n`);
  writeFileSync(join(skillDir, "scripts", "run.js"), "export {};\n");
  return skillDir;
};

test("importLooseSkills moves a complete skill and leaves its client link", () => {
  const paths = fixture();
  const loose = writeSkill(paths.surfaceDirs.agents, "example-skill");

  const report = importLooseSkills(paths, false);

  assert.deepEqual(report.imported, ["example-skill"]);
  assert.ok(lstatSync(loose).isSymbolicLink());
  assert.ok(existsSync(join(paths.sourceSkills, "example-skill", "scripts", "run.js")));
});

test("importLooseSkills dry-run reports the move without touching either location", () => {
  const paths = fixture();
  const loose = writeSkill(paths.surfaceDirs.agents, "example-skill");

  const report = importLooseSkills(paths, true);

  assert.deepEqual(report.imported, ["example-skill"]);
  assert.equal(lstatSync(loose).isSymbolicLink(), false);
  assert.equal(existsSync(join(paths.sourceSkills, "example-skill")), false);
});

test("importLooseSkills skips locked, incomplete, and colliding directories", () => {
  const paths = fixture();
  writeSkill(paths.surfaceDirs.agents, "locked-skill");
  writeSkill(paths.surfaceDirs.agents, "existing-skill");
  writeSkill(paths.sourceSkills, "existing-skill");
  mkdirSync(join(paths.surfaceDirs.agents, "incomplete"), { recursive: true });
  writeFileSync(
    paths.skillLockPath,
    `${JSON.stringify({ skills: { "locked-skill": {} } }, undefined, 2)}\n`,
  );

  const report = importLooseSkills(paths, false);

  assert.deepEqual(report.imported, []);
  assert.equal(report.skipped.length, 3);
  assert.ok(report.skipped.some((action) => action.detail.includes("externally managed")));
  assert.ok(report.skipped.some((action) => action.detail.includes("already present")));
  assert.ok(report.skipped.some((action) => action.detail.includes("not a self-contained skill")));
});
