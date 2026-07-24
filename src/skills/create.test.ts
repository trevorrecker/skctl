import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFrontmatter } from "./frontmatter.js";
import {
  createCommand,
  createSkill,
  renderCommand,
  renderSkill,
  validateName,
} from "./create.js";
import { resolveSkillPaths } from "./paths.js";

const scratch = (): string => mkdtempSync(join(tmpdir(), "skctl-create-"));

test("renderSkill defaults name, description placeholder, and paste", () => {
  const parsed = parseFrontmatter(renderSkill({ name: "demo", paste: true }));
  assert.equal(parsed.data.name, "demo");
  assert.equal(typeof parsed.data.description, "string");
  assert.match(parsed.data.description as string, /TODO/);
  assert.equal(parsed.data.paste, true);
  assert.match(parsed.content, /# demo/);
  assert.match(parsed.content, /What this skill never does/);
});

test("renderSkill quotes a description with YAML-hostile characters", () => {
  const parsed = parseFrontmatter(renderSkill({ name: "demo", description: "Do X: then Y # note" }));
  assert.equal(parsed.data.description, "Do X: then Y # note");
});

test("renderSkill uses a provided plain body verbatim", () => {
  const parsed = parseFrontmatter(renderSkill({ name: "demo", body: "just the body" }));
  assert.equal(parsed.content.trim(), "just the body");
});

test("renderSkill merges a body's frontmatter with CLI args winning and name forced", () => {
  const source = "---\nname: wrong\ndescription: old\nextra: keep\n---\n# heading\n\nbody";
  const parsed = parseFrontmatter(renderSkill({ name: "forced", description: "cli", body: source }));
  assert.equal(parsed.data.name, "forced");
  assert.equal(parsed.data.description, "cli");
  assert.equal(parsed.data.extra, "keep");
  assert.match(parsed.content, /# heading/);
});

test("renderSkill without paste omits the key, even from an inherited body", () => {
  const noFlag = parseFrontmatter(renderSkill({ name: "demo" }));
  assert.equal(noFlag.data.paste, undefined);
  const stripped = parseFrontmatter(renderSkill({ name: "demo", body: "---\npaste: true\n---\nbody" }));
  assert.equal(stripped.data.paste, undefined);
});

test("renderCommand carries description and argumentHint but no name", () => {
  const parsed = parseFrontmatter(renderCommand({ name: "greet", description: "greets", argumentHint: "<name>" }));
  assert.equal(parsed.data.description, "greets");
  assert.equal(parsed.data.argumentHint, "<name>");
  assert.equal(parsed.data.name, undefined);
  assert.match(parsed.content, /\$ARGUMENTS/);
});

test("validateName rejects non-kebab names", () => {
  assert.throws(() => validateName("Foo"), /invalid name/);
  assert.throws(() => validateName("a b"), /invalid name/);
  assert.throws(() => validateName("-lead"), /invalid name/);
  assert.throws(() => validateName(""), /invalid name/);
  validateName("ok-name-2");
});

test("createSkill writes SKILL.md and guards against clobbering", () => {
  const paths = resolveSkillPaths(scratch(), join(scratch(), "root"));
  const dest = createSkill(paths, { name: "demo", description: "d" }, false);
  assert.equal(dest, join(paths.sourceSkills, "demo", "SKILL.md"));
  assert.equal(parseFrontmatter(readFileSync(dest, "utf-8")).data.name, "demo");

  assert.throws(() => createSkill(paths, { name: "demo" }, false), /already exists/);
  const forced = createSkill(paths, { name: "demo", description: "new" }, true);
  assert.equal(parseFrontmatter(readFileSync(forced, "utf-8")).data.description, "new");
});

test("createCommand writes <name>.md and guards against clobbering", () => {
  const paths = resolveSkillPaths(scratch(), join(scratch(), "root"));
  const dest = createCommand(paths, { name: "greet", description: "g" }, false);
  assert.equal(dest, join(paths.sourceCommands, "greet.md"));
  assert.ok(existsSync(dest));
  assert.throws(() => createCommand(paths, { name: "greet" }, false), /already exists/);
});
