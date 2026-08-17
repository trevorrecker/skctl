import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  initRoot,
  loadConfig,
  markRemoteRefreshed,
  remoteRefreshDue,
  resolveRoot,
  saveConfig,
  setInstructionTarget,
  setTagActive,
} from "./config.js";

test("resolveRoot precedence: flag > env > config file", () => {
  const dir = mkdtempSync(join(tmpdir(), "skctl-config-"));
  const configFile = join(dir, "config.json");
  saveConfig({ root: "/from/config" }, configFile);

  delete process.env.SKCTL_ROOT;
  assert.deepEqual(resolveRoot({ configFile }), {
    root: resolve("/from/config"),
    source: "config",
  });

  process.env.SKCTL_ROOT = "/from/env";
  assert.deepEqual(resolveRoot({ configFile }), {
    root: resolve("/from/env"),
    source: "env",
  });

  assert.deepEqual(resolveRoot({ configFile, flagRoot: "/from/flag" }), {
    root: resolve("/from/flag"),
    source: "flag",
  });

  delete process.env.SKCTL_ROOT;
});

test("machine-local settings and remote refresh times round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "skctl-config-"));
  const configFile = join(dir, "config.json");
  const root = join(dir, "skills");
  const now = new Date("2026-08-11T12:00:00.000Z");
  let config = setTagActive({ remoteRefreshHours: 24 }, "work", true);
  config = setInstructionTarget(config, "/custom/AGENTS.md", true);
  config = markRemoteRefreshed(config, root, now);
  saveConfig(config, configFile);

  const loaded = loadConfig(configFile);
  assert.deepEqual(loaded.activeTags, ["work"]);
  assert.deepEqual(loaded.instructionTargets, ["/custom/AGENTS.md"]);
  assert.equal(remoteRefreshDue(loaded, root, new Date("2026-08-12T11:59:00.000Z")), false);
  assert.equal(remoteRefreshDue(loaded, root, new Date("2026-08-12T12:00:00.000Z")), true);
  assert.deepEqual(setTagActive(loaded, "work", false).activeTags, []);
  assert.deepEqual(
    setInstructionTarget(loaded, "/custom/AGENTS.md", false).instructionTargets,
    [],
  );
});

test("resolveRoot throws when nothing is configured", () => {
  delete process.env.SKCTL_ROOT;
  const configFile = join(mkdtempSync(join(tmpdir(), "skctl-config-")), "absent.json");
  assert.throws(() => resolveRoot({ configFile }), /no skills root/);
});

test("initRoot scaffolds the layout and registers the root", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-config-"));
  const root = join(home, "myskills");
  const configFile = join(home, "config.json");

  const result = initRoot(root, configFile);

  assert.equal(result.root, resolve(root));
  for (const sub of ["skills", "commands", "remotes"]) {
    assert.ok(existsSync(join(root, sub)), `${sub} missing`);
  }
  assert.ok(existsSync(join(root, "skills.config.json")));
  assert.equal(loadConfig(configFile).root, resolve(root));
});
