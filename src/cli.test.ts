import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, saveManifest } from "./skills/manifest.js";

const cli = fileURLToPath(new URL("./cli.js", import.meta.url));

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
    XDG_CONFIG_HOME: configHome,
    CLAUDE_CONFIG_DIR: claudeConfig,
    CODEX_HOME: codexHome,
    OPENCODE_CONFIG_DIR: opencodeConfig,
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
    assert.ok(lstatSync(path).isSymbolicLink());
    assert.equal(readFileSync(path, "utf-8"), "# Shared rules\n");
  }
  assert.equal(existsSync(join(home, "AGENTS.md")), false);
  assert.ok(
    existsSync(join(root, "instructions", "AGENTS.md")),
  );
  assert.match(run("status"), /no issues/);

  const extraInstructions = join(home, "client-home", "AGENTS.md");
  run("instruction", "add", extraInstructions, "--no-raycast");
  assert.ok(lstatSync(extraInstructions).isSymbolicLink());
  const listed = JSON.parse(run("instruction", "list", "-o", "json")) as {
    targets: Array<{ target: string; origin: string }>;
  };
  assert.ok(
    listed.targets.some(
      entry => entry.target === extraInstructions && entry.origin === "local",
    ),
  );
  run("instruction", "remove", extraInstructions);
  assert.equal(existsSync(extraInstructions), false);

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

test("CLI reports conflicts through the exit code, quiet mode, and JSON", () => {
  const scratch = mkdtempSync(join(tmpdir(), "skctl-cli-"));
  const home = join(scratch, "home");
  const root = join(scratch, "skills-root");
  mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(scratch, "config"),
    CLAUDE_CONFIG_DIR: join(home, "claude"),
    CODEX_HOME: join(home, "codex"),
    OPENCODE_CONFIG_DIR: join(home, "opencode"),
    FORCE_COLOR: "1",
  };
  const run = (...args: string[]): { output: string; status: number } => {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf-8", env });
    return { output: `${result.stdout}${result.stderr}`, status: result.status ?? 0 };
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
  const payload = JSON.parse(json.output) as {
    command: string;
    summary: { conflicts: number };
    sections: Array<{ name: string; actions: Array<{ kind: string; note?: string }> }>;
  };
  assert.equal(payload.command, "apply");
  assert.equal(payload.summary.conflicts, 1);
  assert.ok(
    payload.sections
      .find(section => section.name === "commands")
      ?.actions.some(action => action.kind === "conflict"),
  );

  assert.match(run("status").output, /\u001B\[/);
  assert.doesNotMatch(run("status", "--no-color").output, /\u001B\[/);
  assert.equal(run("status", "--no-color").status, 0);
});

test("CLI adds a remote from a url, then drops it again", () => {
  const scratch = mkdtempSync(join(tmpdir(), "skctl-cli-"));
  const home = join(scratch, "home");
  const root = join(scratch, "skills-root");
  const upstream = join(scratch, "anti-slop");
  mkdirSync(join(upstream, "skills", "install-anti-slop", "scripts"), { recursive: true });
  writeFileSync(
    join(upstream, "skills", "install-anti-slop", "SKILL.md"),
    "---\nname: install-anti-slop\ndescription: install the plugin\n---\n\nbody\n",
  );
  writeFileSync(join(upstream, "skills", "install-anti-slop", "scripts", "install.mjs"), "//\n");
  mkdirSync(join(upstream, "skills", "spare"), { recursive: true });
  writeFileSync(join(upstream, "skills", "spare", "SKILL.md"), "---\nname: spare\n---\n\nbody\n");
  mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(scratch, "config"),
    CLAUDE_CONFIG_DIR: join(home, "claude"),
    CODEX_HOME: join(home, "codex"),
    OPENCODE_CONFIG_DIR: join(home, "opencode"),
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

  const added = run("remote", "add", upstream, "--skills", "install-anti-slop", "--no-raycast");
  assert.equal(added.status, 0);
  assert.match(added.output, /added remote 'anti-slop' with 1 skill/);
  assert.match(added.output, /not selected: spare/);

  // A skill's bundled installer has to stay reachable through the link chain.
  assert.ok(
    existsSync(join(home, "claude", "skills", "install-anti-slop", "scripts", "install.mjs")),
  );
  assert.equal(existsSync(join(home, ".agents", "skills", "spare")), false);

  const listed = JSON.parse(run("get", "remotes", "-o", "json").output) as Array<{
    alias: string;
    skills: string[];
    available: string[];
  }>;
  assert.deepEqual(listed[0]?.skills, ["install-anti-slop"]);
  assert.deepEqual(listed[0]?.available, ["install-anti-slop", "spare"]);

  // Pulling by url has to resolve back to the alias that already tracks it.
  const pulled = run("pull", upstream, "--no-raycast", "-o", "json");
  assert.equal(pulled.status, 0);
  const pullPayload = JSON.parse(pulled.output) as {
    sections: Array<{ name: string; actions: Array<{ subject?: string; detail: string }> }>;
  };
  const remoteAction = pullPayload.sections.find(section => section.name === "remotes")?.actions[0];
  assert.equal(remoteAction?.subject, "anti-slop");
  assert.match(remoteAction?.detail ?? "", /up to date/);
  assert.equal(run("status").status, 0);

  const dropped = run("remote", "remove", "anti-slop", "--no-raycast");
  assert.equal(dropped.status, 0);
  assert.equal(existsSync(join(home, ".agents", "skills", "install-anti-slop")), false);
  assert.equal(existsSync(join(root, "remotes", "anti-slop")), false);
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
    XDG_CONFIG_HOME: join(scratch, "config"),
    CLAUDE_CONFIG_DIR: join(home, "claude"),
    CODEX_HOME: join(home, "codex"),
    OPENCODE_CONFIG_DIR: join(home, "opencode"),
  };
  const run = (...args: string[]): { output: string; status: number } => {
    const result = spawnSync(process.execPath, [cli, ...args, "--dir", raycast], {
      encoding: "utf-8",
      env,
    });
    return { output: `${result.stdout}${result.stderr}`, status: result.status ?? 0 };
  };

  run("init", root);
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
