import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { adoptInstruction, importInstructions, syncInstructions } from "./instructions.js";
import { doctor } from "./doctor.js";
import { resolveSkillPaths } from "./paths.js";
import type { SkillPaths } from "./paths.js";

const setupSource = (paths: SkillPaths, content: string): void => {
  mkdirSync(join(paths.sourceRepo, "instructions"), { recursive: true });
  writeFileSync(paths.instructionsSource, content);
};

test("instruction targets carry the surface that resolves their host guards", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));

  assert.deepEqual(paths.instructionLinks, [
    { path: join(home, ".claude", "CLAUDE.md"), surface: "claude" },
    { path: join(home, ".codex", "AGENTS.md"), surface: "agents" },
    { path: join(home, ".config", "opencode", "AGENTS.md"), surface: "opencode" },
  ]);
});

test("apply resolves host guards per target and writes real files", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  setupSource(paths, "shared\n<!-- host:claude -->\nclaude only\n<!-- /host -->\n");

  const { actions } = syncInstructions(paths, false);

  assert.ok(actions.every((action) => action.kind === "created"));
  const claude = readFileSync(join(home, ".claude", "CLAUDE.md"), "utf-8");
  const codex = readFileSync(join(home, ".codex", "AGENTS.md"), "utf-8");
  assert.match(claude, /claude only/);
  assert.doesNotMatch(claude, /host:claude/);
  assert.doesNotMatch(codex, /claude only/);
  assert.doesNotMatch(codex, /host:claude/);
});

test("a hand-edited target is a conflict and is left untouched", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  setupSource(paths, "source\n");
  const claude = paths.instructionLinks[0]?.path ?? "";
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(claude, "custom\n");

  const { actions } = syncInstructions(paths, false);

  assert.ok(actions.some((action) => action.detail === claude && action.kind === "conflict"));
  assert.equal(readFileSync(claude, "utf-8"), "custom\n");
});

test("a target skctl owns is rewritten when the source changes", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  setupSource(paths, "first\n");
  const first = syncInstructions(paths, false);
  const claude = paths.instructionLinks[0]?.path ?? "";
  assert.equal(readFileSync(claude, "utf-8"), "first\n");

  writeFileSync(paths.instructionsSource, "second\n");
  const second = syncInstructions(paths, false, first.hashes);

  assert.ok(second.actions.some((action) => action.detail === claude && action.kind === "replaced"));
  assert.equal(readFileSync(claude, "utf-8"), "second\n");
});

test("apply replaces an old-style managed symlink with the compiled file", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  setupSource(paths, "rules\n");
  const claude = paths.instructionLinks[0]?.path ?? "";
  mkdirSync(dirname(claude), { recursive: true });
  symlinkSync(paths.instructionsSource, claude);
  assert.ok(lstatSync(claude).isSymbolicLink());

  const { actions } = syncInstructions(paths, false);

  assert.ok(actions.some((action) => action.detail === claude && action.kind === "replaced"));
  assert.equal(lstatSync(claude).isSymbolicLink(), false);
  assert.equal(readFileSync(claude, "utf-8"), "rules\n");
});

test("adoptInstruction takes over an existing file and returns its hash", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const file = join(home, "CLAUDE.md");
  writeFileSync(file, "old\n");

  const { action, hash } = adoptInstruction(file, "new\n", "claude", false);

  assert.equal(action.kind, "replaced");
  assert.equal(readFileSync(file, "utf-8"), "new\n");
  assert.equal(hash.length, 64);
});

test("importInstructions adopts identical home files and creates the source, not targets", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  writeFileSync(join(home, "AGENTS.md"), "# Rules\n");
  writeFileSync(join(home, "CLAUDE.md"), "# Rules\n");

  const report = importInstructions(paths, false);

  assert.equal(report.imported, true);
  assert.equal(readFileSync(paths.instructionsSource, "utf-8"), "# Rules\n");
  for (const path of paths.instructionImports) assert.equal(existsSync(path), false);
  for (const target of paths.instructionLinks) assert.equal(existsSync(target.path), false);
});

test("importInstructions rejects divergent home files", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  writeFileSync(join(home, "AGENTS.md"), "agents\n");
  writeFileSync(join(home, "CLAUDE.md"), "claude\n");

  assert.throws(() => importInstructions(paths, false), /home instruction files differ/);
  assert.equal(existsSync(paths.instructionsSource), false);
});

test("dry-run import writes nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  writeFileSync(join(home, "AGENTS.md"), "rules\n");

  const report = importInstructions(paths, true);

  assert.equal(report.imported, true);
  assert.equal(report.actions.some((action) => action.kind === "conflict"), false);
  assert.equal(existsSync(paths.instructionsSource), false);
  assert.equal(existsSync(join(home, "AGENTS.md")), true);
});

test("doctor flags a home file that duplicates the compiled instructions", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  setupSource(paths, "rules\n");
  writeFileSync(join(home, "AGENTS.md"), "rules\n");
  syncInstructions(paths, false);

  assert.ok(doctor(paths).issues.some((issue) => issue.label === "duplicate home instructions"));
});

test("doctor flags a hand-edited target using the recorded hash", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  setupSource(paths, "rules\n");
  const { hashes } = syncInstructions(paths, false);
  const claude = paths.instructionLinks[0]?.path ?? "";
  writeFileSync(claude, "hand edit\n");

  assert.ok(
    doctor(paths, hashes).issues.some((issue) => issue.label === "hand-edited instruction"),
  );
});
