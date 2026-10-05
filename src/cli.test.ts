import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "./record.js";
import { loadManifest, saveManifest } from "./skills/manifest.js";
import { resolveProjectTarget } from "./skills/paths.js";
import { loadProjectConfig } from "./skills/project.js";

const cli = fileURLToPath(new URL("./cli.js", import.meta.url));

test("CLI help and version flags never enter command handlers", () => {
  const scratch = mkdtempSync(join(tmpdir(), "skctl-cli-"));
  const home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(scratch, "config"),
    NO_COLOR: undefined,
    FORCE_COLOR: undefined,
  };
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], { encoding: "utf-8", env });

  const version = run("--version");
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^\d+\.\d+\.\d+\s*$/);

  const help = run("init", "--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /skctl\s+portable agent skills/);
  assert.equal(existsSync(join(process.cwd(), "--help")), false);

  const unknown = run("status", "--unknown");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown option: --unknown/);

  const missing = run("create", "skill", "demo", "--description");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--description requires a value/);

  assert.equal(run("init", join(scratch, "skills-root")).status, 0);
  const unknownSkill = run("disable", "skill", "missing", "--no-raycast");
  assert.equal(unknownSkill.status, 1);
  assert.match(unknownSkill.stderr, /unknown skill: missing/);
});

test("CLI manages instruction aliases and machine-local skill tags", () => {
  const scratch = mkdtempSync(join(tmpdir(), "skctl-cli-"));
  const home = join(scratch, "home");
  const root = join(scratch, "skills-root");
  const configHome = join(scratch, "config");
  const claudeConfig = join(scratch, "claude-config");
  const codexHome = join(scratch, "codex-home");
  const opencodeConfig = join(scratch, "opencode-config");
  mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: configHome,
    CLAUDE_CONFIG_DIR: claudeConfig,
    CODEX_HOME: codexHome,
    OPENCODE_CONFIG_DIR: opencodeConfig,
    CURSOR_CONFIG_DIR: join(scratch, "cursor-config"),
  };
  const run = (...args: string[]): string =>
    execFileSync(process.execPath, [cli, ...args], { encoding: "utf-8", env });

  run("init", root);
  run("create", "skill", "core", "--no-paste");
  run("create", "skill", "work-only", "--no-paste", "--tags", "work");
  run("apply", "--no-raycast");

  assert.ok(existsSync(join(home, ".agents", "skills", "core", "SKILL.md")));
  assert.equal(existsSync(join(home, ".agents", "skills", "work-only")), false);

  const enabled = run("enable", "tag", "work", "--no-raycast");
  assert.match(enabled, /activated tag 'work'/);
  assert.ok(existsSync(join(home, ".agents", "skills", "work-only", "SKILL.md")));
  assert.match(run("get", "tags"), /●\s+work/);

  writeFileSync(join(home, "AGENTS.md"), "# Shared rules\n");
  run("import", "instructions");

  for (const path of [
    join(claudeConfig, "CLAUDE.md"),
    join(codexHome, "AGENTS.md"),
    join(opencodeConfig, "AGENTS.md"),
  ]) {
    assert.equal(lstatSync(path).isSymbolicLink(), false);
    assert.equal(readFileSync(path, "utf-8"), "# Shared rules\n");
  }
  assert.equal(existsSync(join(home, "AGENTS.md")), false);
  assert.ok(
    existsSync(join(root, "instructions", "AGENTS.md")),
  );
  assert.match(run("status"), /no issues/);

  const extraHome = join(home, "client-home");
  const extraInstructions = join(extraHome, "AGENTS.md");
  run("dest", "add", extraHome, "--as", "codex", "--no-raycast");
  assert.equal(lstatSync(extraInstructions).isSymbolicLink(), false);
  assert.equal(readFileSync(extraInstructions, "utf-8"), "# Shared rules\n");
  const listed: unknown = JSON.parse(run("dest", "list", "-o", "json"));
  assert.ok(isRecord(listed));
  assert.ok(Array.isArray(listed.destinations));
  const destinations = listed.destinations.filter(isRecord);
  assert.ok(
    destinations.some((entry) => entry.path === extraHome && entry.type === "agents"),
  );
  run("dest", "remove", extraHome);
  assert.equal(existsSync(extraInstructions), false);

  assert.throws(
    () => run("dest", "add", join(home, "cursor-home"), "--as", "cursor"),
    (error: unknown) =>
      error instanceof Error &&
      /not supported yet/.test(`${(error as { stderr?: string }).stderr ?? error.message}`),
  );

  const upstream = join(scratch, "upstream");
  const remoteSkill = join(upstream, "skills", "remote-only");
  mkdirSync(remoteSkill, { recursive: true });
  writeFileSync(join(remoteSkill, "SKILL.md"), "---\nname: remote-only\n---\n\nbody\n");
  const gitEnv = {
    ...env,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", upstream, ...args], { env: gitEnv });
  };
  git("init", "--quiet");
  git("add", ".");
  git("commit", "--quiet", "-m", "seed");
  const manifestPath = join(root, "skills.config.json");
  const manifest = loadManifest(manifestPath);
  manifest.remotes.test = { url: upstream, skills: ["remote-only"] };
  saveManifest(manifestPath, manifest);
  run("config", "set", "refresh", "24h");

  const refreshed = run("apply", "--no-raycast");
  assert.match(refreshed, /scheduled refresh/);
  assert.ok(existsSync(join(home, ".agents", "skills", "remote-only", "SKILL.md")));
  assert.doesNotMatch(run("apply", "--no-raycast"), /scheduled refresh/);
});

test("CLI dry runs of tag and toggle commands write nothing and plan the change", () => {
  const scratch = mkdtempSync(join(tmpdir(), "skctl-cli-"));
  const home = join(scratch, "home");
  const root = join(scratch, "skills-root");
  const configFile = join(scratch, "config", "skctl", "config.json");
  const manifestFile = join(root, "skills.config.json");
  const agents = join(home, ".agents", "skills");
  mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(scratch, "config"),
    CLAUDE_CONFIG_DIR: join(scratch, "claude-config"),
    CODEX_HOME: join(scratch, "codex-home"),
    OPENCODE_CONFIG_DIR: join(scratch, "opencode-config"),
    CURSOR_CONFIG_DIR: join(scratch, "cursor-config"),
  };
  const run = (...args: string[]): string =>
    execFileSync(process.execPath, [cli, ...args, "--no-raycast"], { encoding: "utf-8", env });
  const runJson = (...args: string[]): Record<string, unknown> => {
    const payload: unknown = JSON.parse(run(...args, "-o", "json"));
    assert.ok(isRecord(payload));
    return payload;
  };
  // Every path, link target, and file body under the scratch dir, so any write shows up.
  const snapshot = (dir = scratch): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name);
      const name = relative(scratch, path);
      if (entry.isSymbolicLink()) return [`${name} -> ${readlinkSync(path)}`];
      if (entry.isDirectory()) return [`${name}/`, ...snapshot(path)];
      return [`${name}: ${readFileSync(path, "utf-8")}`];
    });
  const planned = (payload: Record<string, unknown>, subject: string, kind: string): boolean =>
    Array.isArray(payload.sections) &&
    payload.sections.filter(isRecord).some(section =>
      Array.isArray(section.actions) &&
      section.actions.filter(isRecord).some(action =>
        action.subject === subject && action.kind === kind
      )
    );

  run("init", root);
  run("create", "skill", "core", "--no-paste");
  run("create", "skill", "work-only", "--no-paste", "--tags", "work");
  run("create", "command", "greet", "-d", "greets");
  run("apply");
  const before = snapshot();

  const tagPlan = run("enable", "tag", "work", "--dry-run");
  assert.match(tagPlan, /would enable tag 'work'/);
  assert.match(tagPlan, /\(dry run\)/);
  assert.match(tagPlan, /work-only/);
  const tagJson = runJson("enable", "tag", "work", "--dry-run");
  assert.equal(tagJson.dryRun, true);
  assert.ok(planned(tagJson, "work-only", "created"));

  const skillPlan = run("disable", "skill", "core", "--dry-run");
  assert.match(skillPlan, /would disable skill 'core'/);
  assert.match(skillPlan, /\(dry run\)/);
  assert.ok(planned(runJson("disable", "skill", "core", "--dry-run"), "core", "removed"));
  assert.ok(
    planned(runJson("disable", "command", "greet", "--dry-run"), "greet/claude", "removed"),
  );

  assert.match(run("tag", "skill", "core", "extra", "--dry-run"), /would add extra to 'core'/);
  const tagged = runJson("tag", "skill", "core", "extra", "--dry-run");
  assert.deepEqual(tagged, { skill: "core", tags: ["extra"], dryRun: true });
  assert.match(
    run("untag", "skill", "work-only", "work", "--dry-run"),
    /would remove work from 'work-only'/,
  );

  assert.deepEqual(snapshot(), before);

  assert.match(run("enable", "tag", "work"), /activated tag 'work'/);
  const config: unknown = JSON.parse(readFileSync(configFile, "utf-8"));
  assert.ok(isRecord(config));
  assert.deepEqual(config.activeTags, ["work"]);
  assert.ok(lstatSync(join(agents, "work-only")).isSymbolicLink());

  assert.match(run("disable", "skill", "core"), /disabled skill 'core'/);
  assert.equal(loadManifest(manifestFile).skills.core?.enabled, false);
  assert.equal(existsSync(join(agents, "core")), false);

  assert.match(run("tag", "skill", "core", "extra"), /added extra to 'core'/);
  assert.deepEqual(loadManifest(manifestFile).skills.core?.tags, ["extra"]);
});

test("CLI reports conflicts through the exit code, quiet mode, and JSON", () => {
  const scratch = mkdtempSync(join(tmpdir(), "skctl-cli-"));
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
    OPENCODE_CONFIG_DIR: join(home, "opencode"),
    CURSOR_CONFIG_DIR: join(home, "cursor"),
    FORCE_COLOR: "1",
    NO_COLOR: undefined,
  };
  const run = (...args: string[]): { output: string; stdout: string; stderr: string; status: number } => {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf-8", env });
    return {
      output: `${result.stdout}${result.stderr}`,
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status ?? 0,
    };
  };

  run("init", root);
  run("create", "command", "greet", "-d", "greets");
  assert.equal(run("apply", "--no-raycast").status, 0);

  writeFileSync(join(home, "claude", "commands", "greet.md"), "hand written\n");

  const conflicted = run("apply", "--no-raycast");
  assert.equal(conflicted.status, 1);
  assert.match(conflicted.output, /1 conflict/);
  assert.match(conflicted.output, /exists and was not generated/);

  const quiet = run("apply", "--no-raycast", "--quiet");
  assert.equal(quiet.status, 1);
  assert.doesNotMatch(quiet.output, /commands {2}\d+ ok/);
  assert.match(quiet.output, /1 conflict/);

  const json = run("apply", "--no-raycast", "-o", "json");
  assert.equal(json.status, 1);
  assert.doesNotMatch(json.output, /\u001B\[/);
  const payload: unknown = JSON.parse(json.stdout);
  assert.ok(isRecord(payload));
  assert.ok(Array.isArray(payload.hosts));
  assert.ok(isRecord(payload.summary));
  assert.ok(Array.isArray(payload.sections));
  const sections = payload.sections.filter(isRecord);
  assert.equal(payload.command, "apply");
  assert.ok(payload.hosts.includes("cursor"));
  assert.equal(payload.summary.conflicts, 1);
  assert.ok(
    sections.some(section =>
      section.name === "commands" &&
      Array.isArray(section.actions) &&
      section.actions.filter(isRecord).some(action => action.kind === "conflict")
    ),
  );

  assert.match(run("status").output, /\u001B\[/);
  assert.doesNotMatch(run("status", "--no-color").output, /\u001B\[/);
  assert.equal(run("status", "--no-color").status, 0);
});

test("CLI adds a remote from a url, then drops it again", () => {
  const scratch = mkdtempSync(join(tmpdir(), "skctl-cli-"));
  const home = join(scratch, "home");
  const root = join(scratch, "skills-root");
  const upstream = join(scratch, "example-tools");
  mkdirSync(join(upstream, "skills", "install-helper", "scripts"), { recursive: true });
  writeFileSync(
    join(upstream, "skills", "install-helper", "SKILL.md"),
    "---\nname: install-helper\ndescription: install the plugin\n---\n\nbody\n",
  );
  writeFileSync(join(upstream, "skills", "install-helper", "scripts", "install.mjs"), "//\n");
  mkdirSync(join(upstream, "skills", "spare"), { recursive: true });
  writeFileSync(join(upstream, "skills", "spare", "SKILL.md"), "---\nname: spare\n---\n\nbody\n");
  mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(scratch, "config"),
    CLAUDE_CONFIG_DIR: join(home, "claude"),
    CODEX_HOME: join(home, "codex"),
    OPENCODE_CONFIG_DIR: join(home, "opencode"),
    CURSOR_CONFIG_DIR: join(home, "cursor"),
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  for (const args of [["init", "--quiet"], ["add", "."], ["commit", "--quiet", "-m", "seed"]]) {
    execFileSync("git", ["-C", upstream, ...args], { env });
  }
  const run = (...args: string[]): { output: string; status: number } => {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf-8", env });
    return { output: `${result.stdout}${result.stderr}`, status: result.status ?? 0 };
  };

  run("init", root);

  const stray = run("pull", upstream, "--no-raycast");
  assert.equal(stray.status, 1);
  assert.match(stray.output, /no remote tracks/);
  assert.match(stray.output, /skctl remote add/);

  const added = run("remote", "add", upstream, "--skills", "install-helper", "--no-raycast");
  assert.equal(added.status, 0);
  assert.match(added.output, /added remote 'example-tools' with 1 skill/);
  assert.match(added.output, /not selected: spare/);

  // A skill's bundled installer has to stay reachable through the link chain.
  assert.ok(
    existsSync(join(home, "claude", "skills", "install-helper", "scripts", "install.mjs")),
  );
  assert.equal(existsSync(join(home, ".agents", "skills", "spare")), false);

  const listedPayload: unknown = JSON.parse(run("get", "remotes", "-o", "json").output);
  assert.ok(Array.isArray(listedPayload));
  const listed = listedPayload.filter(isRecord);
  assert.deepEqual(listed[0]?.skills, ["install-helper"]);
  assert.deepEqual(listed[0]?.available, ["install-helper", "spare"]);

  // Pulling by url has to resolve back to the alias that already tracks it.
  const pulled = run("pull", upstream, "--no-raycast", "-o", "json");
  assert.equal(pulled.status, 0);
  const pullPayload: unknown = JSON.parse(pulled.output);
  assert.ok(isRecord(pullPayload));
  assert.ok(Array.isArray(pullPayload.sections));
  const remoteSection = pullPayload.sections
    .filter(isRecord)
    .find(section => section.name === "remotes");
  assert.ok(Array.isArray(remoteSection?.actions));
  const remoteAction = remoteSection.actions.filter(isRecord)[0];
  assert.equal(remoteAction?.subject, "example-tools");
  const remoteDetail = remoteAction?.detail;
  assert.ok(typeof remoteDetail === "string");
  assert.match(remoteDetail, /up to date/);
  assert.equal(run("status").status, 0);

  const dropped = run("remote", "remove", "example-tools", "--no-raycast");
  assert.equal(dropped.status, 0);
  assert.equal(existsSync(join(home, ".agents", "skills", "install-helper")), false);
  assert.equal(existsSync(join(root, "remotes", "example-tools")), false);
  assert.equal(run("status").status, 0);
});

test("apply keeps the raycast scripts current without reporting them", () => {
  const scratch = mkdtempSync(join(tmpdir(), "skctl-cli-"));
  const home = join(scratch, "home");
  const root = join(scratch, "skills-root");
  const raycast = join(scratch, "raycast");
  mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(scratch, "config"),
    CLAUDE_CONFIG_DIR: join(home, "claude"),
    CODEX_HOME: join(home, "codex"),
    OPENCODE_CONFIG_DIR: join(home, "opencode"),
    CURSOR_CONFIG_DIR: join(home, "cursor"),
  };
  const run = (...args: string[]): { output: string; status: number } => {
    const result = spawnSync(process.execPath, [cli, ...args, "--dir", raycast], {
      encoding: "utf-8",
      env,
    });
    return { output: `${result.stdout}${result.stderr}`, status: result.status ?? 0 };
  };

  run("init", root);
  run("config", "set", "raycast", "on");
  run("create", "skill", "alpha", "--no-paste");
  assert.doesNotMatch(run("apply").output, /raycast/);

  // The dropdown has to pick the new skill up even though apply stays quiet about it.
  run("create", "skill", "beta", "--no-paste");
  const second = run("apply");
  assert.doesNotMatch(second.output, /raycast/);
  assert.equal(second.status, 0);
  const pasteScript = readFileSync(join(raycast, "skctl-paste.sh"), "utf-8");
  assert.match(pasteScript, /"value":"beta"/);

  // A script someone edited by hand is still worth interrupting for.
  writeFileSync(join(raycast, "skctl-apply.sh"), "#!/bin/bash\necho mine\n");
  const conflicted = run("apply");
  assert.match(conflicted.output, /raycast/);
  assert.match(conflicted.output, /1 conflict/);
  assert.equal(conflicted.status, 1);

  // Turned off, skctl leaves the directory alone entirely.
  run("config", "set", "raycast", "off");
  assert.doesNotMatch(run("apply").output, /raycast/);
  assert.equal(readFileSync(join(raycast, "skctl-apply.sh"), "utf-8"), "#!/bin/bash\necho mine\n");
});

test("project init preserves copy ownership and rejects an explicit mode change", () => {
  const scratch = mkdtempSync(join(tmpdir(), "skctl-project-cli-"));
  const home = join(scratch, "home");
  const root = join(scratch, "skills-root");
  const project = join(scratch, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(scratch, "config"),
    CLAUDE_CONFIG_DIR: join(home, "claude"),
    CODEX_HOME: join(home, "codex"),
    OPENCODE_CONFIG_DIR: join(home, "opencode"),
    CURSOR_CONFIG_DIR: join(home, "cursor"),
  };
  const run = (...args: string[]): { output: string; status: number } => {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf-8", env });
    return { output: `${result.stdout}${result.stderr}`, status: result.status ?? 0 };
  };

  assert.equal(run("init", root).status, 0);
  assert.equal(run("create", "skill", "alpha", "--no-paste", "--no-raycast").status, 0);
  assert.equal(
    run("project", "init", "--skills", "alpha", "--copy", "--dir", project).status,
    0,
  );
  assert.equal(
    run("project", "init", "--skills", "alpha", "--dir", project).status,
    0,
  );

  const target = resolveProjectTarget(project);
  const saved = loadProjectConfig(target);
  assert.equal(saved?.mode, "copy");
  assert.ok((saved?.written?.length ?? 0) > 0);
  assert.equal(lstatSync(join(target.surfaceDirs.agents, "alpha")).isSymbolicLink(), false);

  const changed = run(
    "project",
    "init",
    "--skills",
    "alpha",
    "--link",
    "--dir",
    project,
  );
  assert.equal(changed.status, 1);
  assert.match(changed.output, /project already uses copy mode/);
  assert.equal(loadProjectConfig(target)?.mode, "copy");
});

test("CLI import skips host built-ins and eject hands skills back", () => {
  const scratch = mkdtempSync(join(tmpdir(), "skctl-cli-"));
  const home = join(scratch, "home");
  const root = join(scratch, "skills-root");
  const cursorConfig = join(scratch, "cursor-config");
  mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(scratch, "config"),
    CLAUDE_CONFIG_DIR: join(scratch, "claude-config"),
    CODEX_HOME: join(scratch, "codex-home"),
    OPENCODE_CONFIG_DIR: join(scratch, "opencode-config"),
    CURSOR_CONFIG_DIR: cursorConfig,
  };
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args, "--no-raycast"], { encoding: "utf-8", env });
  const loose = (dir: string, name: string): void => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: x\n---\n\nbody\n`);
  };
  const agents = join(home, ".agents", "skills");
  loose(join(cursorConfig, "skills-cursor"), "canvas");
  loose(agents, "canvas");
  loose(agents, "mine");
  loose(agents, "not-mine");
  assert.equal(run("init", root).status, 0);

  const imported = run("import", "--skip", "not-mine");
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stdout, /imported 1 skill\(s\): mine/);
  assert.match(imported.stdout, /canvas: cursor built-in, left in place/);
  assert.deepEqual(loadManifest(join(root, "skills.config.json")).ejected, ["not-mine"]);

  const usage = run("eject");
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /usage: skctl eject/);

  const ejected = run("eject", "mine");
  assert.equal(ejected.status, 0, ejected.stderr);
  assert.equal(lstatSync(join(agents, "mine")).isSymbolicLink(), false);
  assert.equal(existsSync(join(root, "skills", "mine")), false);

  const adopted = run("import", "--adopt", "mine");
  assert.equal(adopted.status, 0, adopted.stderr);
  assert.ok(lstatSync(join(agents, "mine")).isSymbolicLink());
  assert.deepEqual(loadManifest(join(root, "skills.config.json")).ejected, ["not-mine"]);

  const missing = run("import", "--adopt", "nowhere");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no loose skill in ~\/\.agents\/skills to adopt: nowhere/);

  const builtin = run("import", "--adopt", "canvas");
  assert.equal(builtin.status, 0, builtin.stderr);
  assert.equal(loadManifest(join(root, "skills.config.json")).skills.canvas?.adopted, true);
  const kept = run("eject", "--builtins");
  assert.match(kept.stdout, /nothing ejected/);
  assert.ok(existsSync(join(root, "skills", "canvas", "SKILL.md")));
});
