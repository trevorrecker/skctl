import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { browseReduce, browseRows, browseSelection, browseState, parseKeys } from "./browse.js";
import { isRecord } from "./record.js";
import { discoverRemoteCatalog } from "./skills/remotes.js";
import type { BrowseState } from "./browse.js";

const cli = fileURLToPath(new URL("./cli.js", import.meta.url));

const up = "\u001B[A";
const down = "\u001B[B";
const left = "\u001B[D";
const right = "\u001B[C";
const enter = "\r";

const press = (state: BrowseState, input: string): BrowseState =>
  parseKeys(input).reduce(browseReduce, state);

const labels = (state: BrowseState): string[] =>
  browseRows(state).map((row) => `${row.kind}:${row.label}`);

const seedClone = (skillPaths: readonly string[]): string => {
  const clone = mkdtempSync(join(tmpdir(), "skctl-browse-"));
  for (const path of skillPaths) {
    const dir = join(clone, path);
    mkdirSync(dir, { recursive: true });
    const name = path.slice(path.lastIndexOf("/") + 1);
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n\nbody of ${name}\n`);
  }
  const pstack = join(clone, "pstack", ".cursor-plugin");
  mkdirSync(pstack, { recursive: true });
  writeFileSync(
    join(pstack, "plugin.json"),
    JSON.stringify({ name: "pstack", displayName: "PStack", description: "prompt stack" }),
  );
  const github = join(clone, "third_party", "github", ".claude-plugin");
  mkdirSync(github, { recursive: true });
  writeFileSync(join(github, "plugin.json"), JSON.stringify({ name: "github" }));
  return clone;
};

const pluginPaths = [
  "pstack/skills/bro",
  "pstack/skills/unslop",
  "third_party/github/skills/unslop",
];

const pluginState = (selected: readonly string[] = []): BrowseState =>
  browseState(discoverRemoteCatalog(seedClone(pluginPaths), selected));

test("browse rows nest skills under their plugin group", () => {
  assert.deepEqual(labels(pluginState()), [
    "group:PStack",
    "skill:bro",
    "skill:unslop",
    "group:github",
    "skill:unslop",
  ]);
  const rows = browseRows(pluginState());
  assert.equal(rows[0].detail, "prompt stack");
  assert.equal(rows[2].detail, "pstack/unslop");
  assert.equal(rows[4].detail, "github/unslop");
});

test("arrow movement wraps and j/k mirror it", () => {
  const state = pluginState();
  assert.equal(press(state, up).cursor, 4);
  assert.equal(press(state, `${up}${up}`).cursor, 3);
  assert.equal(press(state, `${down}${down}${down}${down}${down}`).cursor, 0);
  assert.equal(press(state, "jjj").cursor, 3);
  assert.equal(press(state, "k").cursor, 4);
});

test("collapsing a group hides its skills and movement steps over them", () => {
  const collapsed = press(pluginState(), left);

  assert.deepEqual(labels(collapsed), ["group:PStack", "group:github", "skill:unslop"]);
  assert.equal(collapsed.cursor, 0);
  assert.equal(press(collapsed, down).cursor, 1);
  assert.deepEqual(labels(press(collapsed, right)), labels(pluginState()));
});

test("collapsing from a skill row folds its group and lands on the header", () => {
  const folded = press(pluginState(), `${down}${down}${left}`);

  assert.equal(folded.cursor, 0);
  assert.deepEqual(labels(folded), ["group:PStack", "group:github", "skill:unslop"]);
});

test("space selects a skill, and space on a group covers every child", () => {
  const one = press(pluginState(), `${down} `);
  assert.deepEqual(browseSelection(one).selectors, ["bro"]);
  assert.deepEqual(browseSelection(press(one, " ")).selectors, []);

  const whole = press(pluginState(), " ");
  assert.deepEqual(browseSelection(whole).selectors, ["bro", "pstack/unslop"]);
  assert.deepEqual(browseSelection(press(whole, " ")).selectors, []);
});

test("a partly selected group reads as partial, not selected", () => {
  const partial = press(pluginState(), `${down} `);
  const rows = browseRows(partial);

  assert.equal(rows[0].state, "partial");
  assert.equal(rows[1].state, "on");
  assert.equal(rows[2].state, "off");
  assert.equal(browseRows(press(partial, `${up} `))[0].state, "on");
});

test("a collapsed group still toggles the skills it hides", () => {
  const collapsed = press(pluginState(), left);

  assert.deepEqual(browseSelection(press(collapsed, " ")).selectors, ["bro", "pstack/unslop"]);
});

test("filtering narrows the rows and keeps the cursor inside them", () => {
  const filtered = press(pluginState(), `${down}${down}${down}${down}/bro${enter}`);

  assert.deepEqual(labels(filtered), ["group:PStack", "skill:bro"]);
  assert.equal(filtered.cursor, 1);
  assert.equal(filtered.mode, "tree");
  assert.equal(press(filtered, down).cursor, 0);

  const backspaced = press(filtered, `/\u007F\u007F${enter}`);
  assert.equal(backspaced.filter, "b");
  assert.deepEqual(labels(backspaced), [
    "group:PStack",
    "skill:bro",
    "group:github",
    "skill:unslop",
  ]);

  const cleared = press(filtered, "\u001B");
  assert.equal(cleared.filter, "");
  assert.deepEqual(labels(cleared), labels(pluginState()));
});

test("filtering on a group name keeps every skill it ships", () => {
  const filtered = press(pluginState(), `/pstack${enter}`);

  assert.deepEqual(labels(filtered), ["group:PStack", "skill:bro", "skill:unslop"]);
});

test("a filtered group toggles only the skills on screen", () => {
  const filtered = press(pluginState(), `/bro${enter}`);

  assert.deepEqual(browseSelection(press(filtered, " ")).selectors, ["bro"]);
});

test("two colliding skill names commit as separate qualified selectors", () => {
  const all = press(pluginState(), ` ${down}${down}${down} `);

  assert.deepEqual(browseSelection(all).selectors, ["bro", "pstack/unslop", "github/unslop"]);
});

test("the review screen names what the manifest gains and loses", () => {
  const state = pluginState(["pstack/unslop"]);
  assert.deepEqual(browseSelection(state), {
    selectors: ["pstack/unslop"],
    added: [],
    removed: [],
  });

  const edited = press(state, `${down} ${down} ${enter}`);
  assert.equal(edited.mode, "review");
  assert.deepEqual(browseSelection(edited), {
    selectors: ["bro"],
    added: ["bro"],
    removed: ["pstack/unslop"],
  });

  assert.equal(press(edited, "\u001B").mode, "tree");
  assert.equal(press(edited, enter).exit, "commit");
  assert.equal(press(edited, "q").exit, "abort");
});

test("peek shows one skill and any key returns to the tree", () => {
  const peeked = press(pluginState(), `${down}p`);
  assert.equal(peeked.mode, "peek");
  assert.equal(press(peeked, "x").mode, "tree");

  assert.equal(press(pluginState(), "p").mode, "tree");
});

test("ctrl-c and q leave without a commit", () => {
  assert.equal(press(pluginState(), "q").exit, "abort");
  assert.equal(press(pluginState(), "\u0003").exit, "abort");
  assert.equal(press(pluginState(), `${enter}\u0003`).exit, "abort");
});

test("parseKeys names arrows, controls, and typed characters", () => {
  assert.deepEqual(parseKeys(`${up}${down}${left}${right}`), [
    { name: "up" },
    { name: "down" },
    { name: "left" },
    { name: "right" },
  ]);
  assert.deepEqual(parseKeys("\u001BOA"), [{ name: "up" }]);
  assert.deepEqual(parseKeys("\u001B[Z"), [{ name: "other" }]);
  assert.deepEqual(parseKeys("\u001B"), [{ name: "escape" }]);
  assert.deepEqual(parseKeys("q "), [{ name: "char", char: "q" }, { name: "space" }]);
});

const seedUpstream = (): string => {
  const scratch = mkdtempSync(join(tmpdir(), "skctl-browse-cli-"));
  const upstream = join(scratch, "plugins");
  mkdirSync(upstream, { recursive: true });
  for (const path of pluginPaths) {
    const dir = join(upstream, path);
    mkdirSync(dir, { recursive: true });
    const name = path.slice(path.lastIndexOf("/") + 1);
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n\nbody\n`);
  }
  const pstack = join(upstream, "pstack", ".cursor-plugin");
  mkdirSync(pstack, { recursive: true });
  writeFileSync(
    join(pstack, "plugin.json"),
    JSON.stringify({ name: "pstack", displayName: "PStack", description: "prompt stack" }),
  );
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  for (const args of [["init", "--quiet"], ["add", "."], ["commit", "--quiet", "-m", "seed"]]) {
    execFileSync("git", ["-C", upstream, ...args], { env });
  }
  return upstream;
};

test("browse prints the grouped tree without a terminal", () => {
  const upstream = seedUpstream();
  const scratch = mkdtempSync(join(tmpdir(), "skctl-browse-home-"));
  const home = join(scratch, "home");
  const root = join(scratch, "skills-root");
  mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(scratch, "config"),
    CLAUDE_CONFIG_DIR: join(home, "claude"),
    CODEX_HOME: join(home, "codex"),
    CURSOR_CONFIG_DIR: join(home, "cursor"),
    OPENCODE_CONFIG_DIR: join(home, "opencode"),
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  const run = (...args: string[]): { output: string; status: number } => {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf-8", env });
    return { output: `${result.stdout}${result.stderr}`, status: result.status ?? 0 };
  };

  run("init", root);

  // An untracked url clones far enough to show what it offers, then leaves nothing behind.
  const fresh = run("browse", upstream, "-o", "json");
  assert.equal(fresh.status, 0);
  const payload: unknown = JSON.parse(fresh.output);
  assert.ok(isRecord(payload));
  assert.ok(Array.isArray(payload.catalog));
  const catalog = payload.catalog.filter(isRecord);
  assert.equal(catalog.length, payload.catalog.length);
  assert.equal(payload.alias, "plugins");
  assert.deepEqual(catalog.map((entry) => entry.selector), [
    "bro",
    "pstack/unslop",
    "github/unslop",
  ]);
  assert.deepEqual(catalog.map((entry) => entry.selected), [false, false, false]);
  assert.equal(existsSync(join(root, "remotes", "plugins")), false);
  assert.deepEqual(JSON.parse(run("get", "remotes", "-o", "json").output), []);

  run("remote", "add", upstream, "--skills", "pstack/unslop", "--no-raycast");
  const tracked = run("browse", "plugins");
  assert.equal(tracked.status, 0);
  assert.match(tracked.output, /browse {2}plugins/);
  assert.match(tracked.output, /selected {2}1 of 3/);
  assert.match(tracked.output, /PStack {2}prompt stack/);
  assert.match(tracked.output, /● pstack\/unslop/);
  assert.match(tracked.output, /○ github\/unslop/);

  const unknown = run("browse", "nope");
  assert.equal(unknown.status, 1);
  assert.match(unknown.output, /no remote named 'nope'/);
});
