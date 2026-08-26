import test from "node:test";
import assert from "node:assert/strict";
import {
  RaycastTarget,
  compileBody,
  compileSkill,
  planSurfaces,
  variantSurfaces,
} from "./compile.js";
import { parseOverlay } from "./overlays.js";
import type { Action } from "./types.js";

const overlayFrom = (frontmatter: string): ReturnType<typeof parseOverlay> => {
  const problems: Action[] = [];
  const overlay = parseOverlay("demo", "overlays/demo.md", `---\n${frontmatter}---\n`, problems);
  assert.deepEqual(problems, []);
  return overlay;
};

test("compileSkill strips skctl's own keys and anything the surface rejects", () => {
  const source = [
    "---",
    "name: demo",
    "description: does a thing",
    "paste: true",
    "tags: [work]",
    "context: fork",
    "argument-hint: <name>",
    "---",
    "",
    "body",
  ].join("\n");

  const claude = compileSkill("demo", source, "claude");
  assert.match(claude.content, /^---\nname: demo\n/);
  assert.match(claude.content, /context: fork/);
  assert.doesNotMatch(claude.content, /paste/);
  assert.doesNotMatch(claude.content, /tags/);
  assert.match(claude.content, /argument-hint: <name>/);
  assert.deepEqual(claude.dropped, []);

  const agents = compileSkill("demo", source, "agents");
  assert.doesNotMatch(agents.content, /context/);
  assert.deepEqual(agents.dropped, ["argument-hint", "context"]);
});

test("compileSkill forces name to the skill directory name", () => {
  const compiled = compileSkill("real-name", "---\nname: stale\n---\n\nbody\n", "cursor");
  assert.match(compiled.content, /name: real-name/);
  assert.doesNotMatch(compiled.content, /stale/);
});

test("compileSkill maps camelCase frontmatter onto the kebab-case keys clients read", () => {
  const compiled = compileSkill(
    "demo",
    "---\nname: demo\nallowedTools: Read Grep\n---\n\nbody\n",
    "claude",
  );
  assert.match(compiled.content, /allowed-tools: Read Grep/);
  assert.doesNotMatch(compiled.content, /allowedTools/);
});

test("provider-specific frontmatter survives only on the clients that support it", () => {
  const source = [
    "---",
    "name: demo",
    "when_to_use: Use for demos",
    "arguments: <path>",
    "agent: Explore",
    "background: true",
    "icon: wrench",
    "color: blue",
    "---",
    "",
    "body",
  ].join("\n");

  const claude = compileSkill("demo", source, "claude").content;
  assert.match(claude, /when_to_use: Use for demos/);
  assert.match(claude, /arguments: <path>/);
  assert.match(claude, /agent: Explore/);
  assert.match(claude, /background: true/);
  assert.doesNotMatch(claude, /icon:|color:/);

  const cursor = compileSkill("demo", source, "cursor").content;
  assert.match(cursor, /icon: wrench/);
  assert.match(cursor, /color: blue/);
  assert.doesNotMatch(cursor, /when_to_use|arguments:|agent:|background:/);
});

test("guards keep content on the surface that names them and drop it elsewhere", () => {
  const source = [
    "---",
    "name: demo",
    "---",
    "",
    "<!-- host:claude -->",
    "read @notes.md first",
    "<!-- /host -->",
    "<!-- host:!claude -->",
    "read notes.md first",
    "<!-- /host -->",
    "",
    "shared line",
  ].join("\n");

  assert.match(compileSkill("demo", source, "claude").content, /read @notes\.md first/);
  assert.doesNotMatch(compileSkill("demo", source, "claude").content, /^read notes\.md/m);
  assert.match(compileSkill("demo", source, "agents").content, /^read notes\.md first$/m);
  assert.match(compileSkill("demo", source, "agents").content, /shared line/);
});

test("a codex guard resolves to the agents surface, the only user path codex reads", () => {
  const source = "---\nname: demo\n---\n\n<!-- host:codex -->\ncodex only\n<!-- /host -->\n";
  assert.match(compileSkill("demo", source, "agents").content, /codex only/);
  assert.doesNotMatch(compileSkill("demo", source, "claude").content, /codex only/);
  assert.deepEqual(variantSurfaces(source), ["agents"]);
});

test("invalid host guards fail before compilation", () => {
  const source = (body: string): string => `---\nname: demo\n---\n\n${body}\n`;

  assert.throws(
    () => compileSkill("demo", source("<!-- host:claude -->\nmissing close"), "claude"),
    /missing a closing marker/,
  );
  assert.throws(
    () => compileSkill(
      "demo",
      source("<!-- host:claude -->\n<!-- host:codex -->\nnested\n<!-- /host -->\n<!-- /host -->"),
      "claude",
    ),
    /cannot be nested/,
  );
  assert.throws(
    () => compileSkill("demo", source("<!-- host:private-client -->\nbody\n<!-- /host -->"), "claude"),
    /unknown host guard target/,
  );
});

test("overlay replacements run in declared order", () => {
  const overlay = overlayFrom("replace:\n  one: two\n  two: three\n");
  const compiled = compileSkill("demo", "---\nname: demo\n---\n\none\n", "agents", overlay);
  assert.match(compiled.content, /three/);
});

test("overlay set and drop apply before the surface allowlist", () => {
  const overlay = overlayFrom("set:\n  allowed-tools: Read Grep\ndrop: [description]\n");
  const compiled = compileSkill(
    "demo",
    "---\nname: demo\ndescription: gone\n---\n\nbody\n",
    "agents",
    overlay,
  );
  assert.match(compiled.content, /allowed-tools: Read Grep/);
  assert.doesNotMatch(compiled.content, /description/);
});

test("a surface-scoped overlay only touches that surface", () => {
  const overlay = overlayFrom("claude:\n  set:\n    context: fork\n");
  assert.match(compileSkill("demo", "---\nname: demo\n---\n\nx\n", "claude", overlay).content, /context: fork/);
  assert.doesNotMatch(compileSkill("demo", "---\nname: demo\n---\n\nx\n", "agents", overlay).content, /context/);
  assert.deepEqual(variantSurfaces("---\nname: demo\n---\n\nx\n", overlay), ["claude"]);
});

test("an invalid replace pattern is reported rather than thrown", () => {
  const problems: Action[] = [];
  parseOverlay("demo", "overlays/demo.md", "---\nreplace:\n  '([': x\n---\n", problems);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, "conflict");
  assert.match(problems[0].detail, /invalid replace pattern/);
});

test("replace accepts an array of pairs so a numeric pattern keeps its place", () => {
  const overlay = overlayFrom("replace:\n  - ['404', 'gone']\n  - ['gone', 'missing']\n");
  const compiled = compileSkill("demo", "---\nname: demo\n---\n\n404\n", "agents", overlay);
  assert.match(compiled.content, /missing/);
});

test("planSurfaces covers every host with two surfaces and no spill", () => {
  const plan = planSurfaces(["claude", "codex", "opencode", "cursor"]);
  assert.deepEqual(plan.surfaces, ["claude", "agents"]);
  assert.deepEqual(plan.spill, []);
});

test("planSurfaces reports the spill when a host cannot be reached alone", () => {
  const plan = planSurfaces(["claude"]);
  assert.deepEqual(plan.surfaces, ["claude"]);
  assert.deepEqual(plan.spill, ["cursor", "opencode"]);
});

test("planSurfaces uses an exclusive directory when one exists", () => {
  assert.deepEqual(planSurfaces(["opencode"]).surfaces, ["opencode"]);
  assert.deepEqual(planSurfaces(["opencode"]).spill, []);
  assert.deepEqual(planSurfaces(["cursor"]).surfaces, ["cursor"]);
});

test("planSurfaces honors a required surface from a variant", () => {
  const plan = planSurfaces(["claude", "codex", "opencode", "cursor"], ["opencode"]);
  assert.ok(plan.surfaces.includes("opencode"));
  assert.ok(plan.surfaces.includes("claude"));
  assert.ok(plan.surfaces.includes("agents"));
});

test("a required variant cannot broaden the declared host set", () => {
  const plan = planSurfaces(["codex"], ["claude"]);
  assert.deepEqual(plan.surfaces, ["agents"]);
  assert.deepEqual(plan.spill, ["cursor", "opencode"]);
});

test("compileBody drops frontmatter and resolves guards for the paste target", () => {
  const source = [
    "---",
    "name: demo",
    "description: d",
    "---",
    "",
    "<!-- host:raycast -->",
    "paste form",
    "<!-- /host -->",
    "<!-- host:claude -->",
    "claude form",
    "<!-- /host -->",
  ].join("\n");
  const body = compileBody(source, RaycastTarget);
  assert.match(body, /paste form/);
  assert.doesNotMatch(body, /claude form/);
  assert.doesNotMatch(body, /description/);
});
