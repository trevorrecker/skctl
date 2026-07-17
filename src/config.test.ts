import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { initRoot, loadConfig, resolveRoot, saveConfig } from "./config.js";

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
