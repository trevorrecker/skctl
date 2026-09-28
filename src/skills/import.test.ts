import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importLooseSkills } from "./import.js";
import { defaultManifest, setEjected } from "./manifest.js";
import { resolveSkillPaths } from "./paths.js";

const fixture = () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-import-"));
  return { home, paths: resolveSkillPaths(home, join(home, "root")) };
};

const writeSkill = (dir: string, name: string, frontmatter = ""): string => {
  const skillDir = join(dir, name);
  mkdirSync(join(skillDir, "scripts"), { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${name}\n${frontmatter}---\n\nbody\n`);
  writeFileSync(join(skillDir, "scripts", "run.js"), "export {};\n");
  return skillDir;
};

test("importLooseSkills moves a complete skill and leaves its client link", () => {
  const { paths } = fixture();
  const loose = writeSkill(paths.surfaceDirs.agents, "example-skill");

  const report = importLooseSkills(paths, defaultManifest(), { dryRun: false });

  assert.deepEqual(report.imported, ["example-skill"]);
  assert.ok(lstatSync(loose).isSymbolicLink());
  assert.ok(existsSync(join(paths.sourceSkills, "example-skill", "scripts", "run.js")));
});

test("importLooseSkills dry-run reports the move without touching either location", () => {
  const { paths } = fixture();
  const loose = writeSkill(paths.surfaceDirs.agents, "example-skill");

  const report = importLooseSkills(paths, defaultManifest(), { dryRun: true });

  assert.deepEqual(report.imported, ["example-skill"]);
  assert.equal(lstatSync(loose).isSymbolicLink(), false);
  assert.equal(existsSync(join(paths.sourceSkills, "example-skill")), false);
});

test("importLooseSkills skips locked, incomplete, and colliding directories", () => {
  const { paths } = fixture();
  writeSkill(paths.surfaceDirs.agents, "locked-skill");
  writeSkill(paths.surfaceDirs.agents, "existing-skill");
  writeSkill(paths.sourceSkills, "existing-skill");
  mkdirSync(join(paths.surfaceDirs.agents, "incomplete"), { recursive: true });
  writeFileSync(
    paths.skillLockPath,
    `${JSON.stringify({ skills: { "locked-skill": {} } }, undefined, 2)}\n`,
  );

  const report = importLooseSkills(paths, defaultManifest(), { dryRun: false });

  assert.deepEqual(report.imported, []);
  assert.equal(report.skipped.length, 3);
  assert.ok(report.skipped.some((action) => action.detail.includes("externally managed")));
  assert.ok(report.skipped.some((action) => action.detail.includes("already present")));
  assert.ok(report.skipped.some((action) => action.detail.includes("not a self-contained skill")));
});

test("importLooseSkills leaves host built-ins in place unless adopted", () => {
  const { home, paths } = fixture();
  writeSkill(join(home, ".cursor", "skills-cursor"), "canvas");
  writeSkill(join(home, ".codex", "skills", ".system"), "imagegen");
  const listed = writeSkill(paths.surfaceDirs.agents, "canvas");
  writeSkill(paths.surfaceDirs.agents, "imagegen");
  writeSkill(paths.surfaceDirs.agents, "env-setup", "environments:\n  - cloud\n");
  writeSkill(paths.surfaceDirs.agents, "mine");

  const report = importLooseSkills(paths, defaultManifest(), { dryRun: false });

  assert.deepEqual(report.imported, ["mine"]);
  assert.ok(report.skipped.some((action) => action.detail === "canvas: cursor built-in, left in place"));
  assert.ok(report.skipped.some((action) => action.detail === "imagegen: codex built-in, left in place"));
  assert.ok(report.skipped.some((action) => action.detail.startsWith("env-setup: looks like a cursor built-in")));
  assert.equal(lstatSync(listed).isSymbolicLink(), false);

  const adopted = importLooseSkills(paths, defaultManifest(), {
    dryRun: false,
    adopt: new Set(["canvas"]),
  });
  assert.deepEqual(adopted.imported, ["canvas"]);
  assert.ok(existsSync(join(paths.sourceSkills, "canvas", "SKILL.md")));
});

test("importLooseSkills honors ejected names and records skipped ones", () => {
  const { paths } = fixture();
  writeSkill(paths.surfaceDirs.agents, "handed-back");
  writeSkill(paths.surfaceDirs.agents, "declined");
  const manifest = setEjected(defaultManifest(), "handed-back");

  const report = importLooseSkills(paths, manifest, {
    dryRun: false,
    skip: new Set(["declined", "not-here-yet"]),
  });

  assert.deepEqual(report.imported, []);
  assert.deepEqual(report.ejected, ["declined", "not-here-yet"]);
  assert.ok(report.skipped.some((action) => action.detail === "handed-back: ejected, left in place"));
  assert.ok(existsSync(join(paths.surfaceDirs.agents, "declined", "SKILL.md")));
});
