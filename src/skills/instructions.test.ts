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
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importInstructions, syncInstructions } from "./instructions.js";
import { doctor } from "./doctor.js";
import { resolveSkillPaths } from "./paths.js";

test("resolveSkillPaths keeps a custom home inside its own config tree", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));

  assert.deepEqual(paths.instructionLinks, [
    join(home, ".claude", "CLAUDE.md"),
    join(home, ".codex", "AGENTS.md"),
    join(home, ".config", "opencode", "AGENTS.md"),
  ]);
});

test("resolveSkillPaths uses each client config directory for instructions and commands", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const root = join(home, "skills-root");
  const claudeConfig = join(home, "custom-claude");
  const codexHome = join(home, "custom-codex");
  const opencodeConfig = join(home, "custom-opencode");
  const paths = resolveSkillPaths(
    home,
    root,
    claudeConfig,
    codexHome,
    opencodeConfig,
  );

  assert.deepEqual(paths.instructionLinks, [
    join(claudeConfig, "CLAUDE.md"),
    join(codexHome, "AGENTS.md"),
    join(opencodeConfig, "AGENTS.md"),
  ]);
  assert.equal(paths.commandDirs.opencode, join(opencodeConfig, "commands"));
});

test("importInstructions adopts matching home files and links client paths", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const root = join(home, "skills-root");
  const claudeConfig = join(home, "custom-claude");
  const codexHome = join(home, "custom-codex");
  const paths = resolveSkillPaths(
    home,
    root,
    claudeConfig,
    codexHome,
  );
  writeFileSync(join(home, "AGENTS.md"), "# Rules\n");
  symlinkSync("AGENTS.md", join(home, "CLAUDE.md"));

  const report = importInstructions(paths, false);

  assert.equal(report.imported, true);
  assert.equal(readFileSync(paths.instructionsSource, "utf-8"), "# Rules\n");
  for (const path of paths.instructionImports) {
    assert.equal(existsSync(path), false);
  }
  for (const path of paths.instructionLinks) {
    assert.ok(lstatSync(path).isSymbolicLink());
    assert.equal(readFileSync(path, "utf-8"), "# Rules\n");
  }
  assert.ok(lstatSync(join(codexHome, "AGENTS.md")).isSymbolicLink());
});

test("syncInstructions leaves a real file with different content untouched", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  mkdirSync(join(paths.sourceRepo, "instructions"), { recursive: true });
  writeFileSync(paths.instructionsSource, "source\n");
  const claudeInstructions = paths.instructionLinks[0];
  assert.ok(claudeInstructions);
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(claudeInstructions, "custom\n");

  const actions = syncInstructions(paths, false);

  assert.ok(actions.some(action => action.kind === "conflict"));
  assert.equal(readFileSync(claudeInstructions, "utf-8"), "custom\n");
  assert.ok(existsSync(paths.instructionsSource));
});

test("dry-run plans an import without treating the adopted file as a conflict", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  writeFileSync(join(home, "AGENTS.md"), "rules\n");

  const report = importInstructions(paths, true);

  assert.equal(report.imported, true);
  assert.equal(report.actions.some(action => action.kind === "conflict"), false);
  assert.equal(existsSync(paths.instructionsSource), false);
  assert.equal(lstatSync(join(home, "AGENTS.md")).isSymbolicLink(), false);
});

test("syncInstructions does not write hierarchy files in the home directory", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  mkdirSync(join(paths.sourceRepo, "instructions"), { recursive: true });
  writeFileSync(paths.instructionsSource, "rules\n");

  syncInstructions(paths, false);

  assert.equal(lstatSync(paths.instructionsSource).isSymbolicLink(), false);
  assert.equal(existsSync(join(home, "AGENTS.md")), false);
  assert.equal(existsSync(join(home, "CLAUDE.md")), false);
});

test("importInstructions rejects different home instruction files", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  writeFileSync(join(home, "AGENTS.md"), "agents\n");
  writeFileSync(join(home, "CLAUDE.md"), "claude\n");

  assert.throws(
    () => importInstructions(paths, false),
    /instruction files have different content/,
  );
  assert.equal(existsSync(paths.instructionsSource), false);
});

test("doctor flags home hierarchy files beside managed instructions", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-instructions-"));
  const paths = resolveSkillPaths(home, join(home, "skills-root"));
  mkdirSync(join(paths.sourceRepo, "instructions"), { recursive: true });
  writeFileSync(paths.instructionsSource, "rules\n");
  writeFileSync(join(home, "AGENTS.md"), "rules\n");
  syncInstructions(paths, false);

  assert.ok(
    doctor(paths).issues.some(issue => issue.label === "duplicate home instructions"),
  );
});
