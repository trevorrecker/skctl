import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctor } from "./doctor.js";
import { pathPresent } from "./fsx.js";
import { defaultManifest, loadManifest, saveManifest, setEjected } from "./manifest.js";
import { resolveSkillPaths } from "./paths.js";
import { builtinShadows, ejectSkill, ejectSkills } from "./eject.js";
import { sync } from "./sync.js";
import type { SkillPaths } from "./paths.js";

const machine = (root?: string) => {
  const home = mkdtempSync(join(tmpdir(), "skctl-eject-"));
  return { home, paths: resolveSkillPaths(home, root ?? join(home, "root")) };
};

const writeSkill = (dir: string, name: string, body = "body"): void => {
  mkdirSync(join(dir, name, "scripts"), { recursive: true });
  writeFileSync(
    join(dir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: demo\n---\n\n${body}\n<!-- host:claude -->\nclaude only\n<!-- /host -->\n`,
  );
  writeFileSync(join(dir, name, "scripts", "run.js"), "export {};\n");
};

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

const git = (repo: string, ...args: string[]): void => {
  execFileSync("git", ["-C", repo, ...args], { env: gitEnv, stdio: "ignore" });
};

const applyManifest = (paths: SkillPaths) => sync(paths, loadManifest(paths.manifestPath), false);

test("eject hands a skill back to ~/.agents/skills as a standalone copy", () => {
  const { paths } = machine();
  writeSkill(paths.sourceSkills, "mine");
  applyManifest(paths);
  const agentsCopy = join(paths.surfaceDirs.agents, "mine");
  assert.ok(lstatSync(agentsCopy).isSymbolicLink());

  const result = ejectSkill(paths, loadManifest(paths.manifestPath), "mine", false);
  saveManifest(paths.manifestPath, result.manifest);
  applyManifest(paths);

  assert.equal(lstatSync(agentsCopy).isSymbolicLink(), false);
  assert.equal(lstatSync(join(agentsCopy, "scripts")).isSymbolicLink(), false);
  assert.ok(existsSync(join(agentsCopy, "scripts", "run.js")));
  assert.doesNotMatch(readFileSync(join(agentsCopy, "SKILL.md"), "utf-8"), /claude only/);
  assert.equal(existsSync(join(paths.sourceSkills, "mine")), false);
  assert.equal(pathPresent(join(paths.surfaceDirs.claude, "mine")), false);
  assert.deepEqual(loadManifest(paths.manifestPath).ejected, ["mine"]);
  assert.ok(doctor(paths).notes.some((note) => note.label === "ejected" && note.detail === "mine"));
});

test("eject leaves a host built-in with its host and records nothing", () => {
  const { home, paths } = machine();
  writeSkill(join(home, ".cursor", "skills-cursor"), "canvas");
  writeSkill(paths.sourceSkills, "canvas");
  writeSkill(paths.sourceSkills, "mine");
  applyManifest(paths);
  assert.deepEqual(builtinShadows(paths, loadManifest(paths.manifestPath)), ["canvas"]);
  assert.ok(doctor(paths).issues.some((issue) => issue.label === "shadows host built-in"));

  const manifest = loadManifest(paths.manifestPath);
  const result = ejectSkills(paths, manifest, builtinShadows(paths, manifest), false);
  saveManifest(paths.manifestPath, result.manifest);
  applyManifest(paths);

  assert.deepEqual(loadManifest(paths.manifestPath).ejected, []);
  assert.equal(existsSync(join(paths.sourceSkills, "canvas")), false);
  assert.equal(pathPresent(join(paths.surfaceDirs.agents, "canvas")), false);
  assert.equal(pathPresent(join(paths.surfaceDirs.claude, "canvas")), false);
  assert.ok(existsSync(join(home, ".cursor", "skills-cursor", "canvas", "SKILL.md")));
  assert.ok(existsSync(join(paths.sourceSkills, "mine", "SKILL.md")));
});

test("eject refuses to overwrite a real directory it did not create", () => {
  const { paths } = machine();
  writeSkill(paths.sourceSkills, "mine");
  writeSkill(paths.surfaceDirs.agents, "mine", "someone else's");

  const result = ejectSkill(paths, defaultManifest(), "mine", false);

  assert.equal(result.actions[0]?.kind, "conflict");
  assert.deepEqual(result.manifest.ejected, []);
  assert.ok(existsSync(join(paths.sourceSkills, "mine", "SKILL.md")));
});

test("eject dry-run changes nothing", () => {
  const { paths } = machine();
  writeSkill(paths.sourceSkills, "mine");
  applyManifest(paths);

  const result = ejectSkill(paths, loadManifest(paths.manifestPath), "mine", true);

  assert.ok(result.actions.every((action) => action.kind !== "conflict"));
  assert.ok(lstatSync(join(paths.surfaceDirs.agents, "mine")).isSymbolicLink());
  assert.ok(existsSync(join(paths.sourceSkills, "mine", "SKILL.md")));
});

test("another machine hands an ejected skill back from git history on its next apply", () => {
  const upstream = mkdtempSync(join(tmpdir(), "skctl-eject-upstream-"));
  const first = machine(join(upstream, "root"));
  writeSkill(first.paths.sourceSkills, "mine");
  mkdirSync(first.paths.overlaysDir, { recursive: true });
  writeFileSync(join(first.paths.overlaysDir, "mine.md"), "---\nreplace:\n  body: overlaid\n---\n");
  git(first.paths.sourceRepo, "init", "--quiet");
  git(first.paths.sourceRepo, "add", ".");
  git(first.paths.sourceRepo, "commit", "--quiet", "-m", "seed");

  const second = machine();
  execFileSync("git", ["clone", "--quiet", first.paths.sourceRepo, second.paths.sourceRepo], {
    env: gitEnv,
    stdio: "ignore",
  });
  applyManifest(second.paths);
  assert.ok(lstatSync(join(second.paths.surfaceDirs.agents, "mine")).isSymbolicLink());

  const result = ejectSkill(first.paths, loadManifest(first.paths.manifestPath), "mine", false);
  saveManifest(first.paths.manifestPath, result.manifest);
  git(first.paths.sourceRepo, "add", "-A");
  git(first.paths.sourceRepo, "commit", "--quiet", "-m", "eject mine");
  git(second.paths.sourceRepo, "pull", "--quiet", "--ff-only");

  const handed = applyManifest(second.paths);

  const handback = handed.skills.find((action) => action.subject === "mine" && action.kind !== "removed");
  assert.match(handback?.note ?? "", /^ejected elsewhere, handed back from [0-9a-f]+$/);
  const copy = join(second.paths.surfaceDirs.agents, "mine");
  assert.equal(lstatSync(copy).isSymbolicLink(), false);
  assert.ok(existsSync(join(copy, "scripts", "run.js")));
  const handedBody = readFileSync(join(copy, "SKILL.md"), "utf-8");
  assert.doesNotMatch(handedBody, /claude only/);
  assert.match(handedBody, /overlaid/);
  assert.equal(pathPresent(join(second.paths.surfaceDirs.claude, "mine")), false);

  const again = applyManifest(second.paths);
  assert.equal(again.skills.some((action) => action.subject === "mine"), false);
});

test("without history the last build is handed back and missing files are named", () => {
  const { paths } = machine();
  writeSkill(paths.sourceSkills, "mine");
  applyManifest(paths);
  rmSync(join(paths.sourceSkills, "mine"), { recursive: true });
  saveManifest(paths.manifestPath, setEjected(defaultManifest(), "mine"));

  const handed = applyManifest(paths);

  const copy = join(paths.surfaceDirs.agents, "mine");
  assert.equal(lstatSync(copy).isSymbolicLink(), false);
  assert.ok(existsSync(join(copy, "SKILL.md")));
  assert.ok(
    handed.skills.some((action) => action.note === "ejected elsewhere, handed back from the agents build without scripts"),
  );
});

test("a machine that never served an ejected skill has nothing to hand back", () => {
  const { paths } = machine();
  mkdirSync(paths.sourceSkills, { recursive: true });
  saveManifest(paths.manifestPath, setEjected(defaultManifest(), "mine"));

  applyManifest(paths);

  assert.equal(pathPresent(join(paths.surfaceDirs.agents, "mine")), false);
});
