import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import {
  defaultManifest,
  loadManifest,
  resolveEntry,
  saveManifest,
  setEnabled,
} from "./manifest.js";

test("loadManifest returns defaults when the file is absent", () => {
  const manifest = loadManifest(join(tmpdir(), "does-not-exist.json"));
  assert.deepEqual(manifest.defaultHosts, ["claude", "codex", "opencode"]);
  assert.deepEqual(manifest.skills, {});
});

test("resolveEntry defaults to enabled with the manifest's default hosts", () => {
  const manifest = defaultManifest();
  assert.deepEqual(resolveEntry("a", undefined, manifest), {
    name: "a",
    enabled: true,
    hosts: ["claude", "codex", "opencode"],
  });
  assert.equal(resolveEntry("b", { enabled: false }, manifest).enabled, false);
  assert.deepEqual(
    resolveEntry("c", { hosts: ["claude"] }, manifest).hosts,
    ["claude"],
  );
});

test("setEnabled and round-trip through disk preserve toggles", () => {
  const dir = mkdtempSync(join(tmpdir(), "skctl-manifest-"));
  const path = join(dir, "skills.config.json");
  const manifest = setEnabled(defaultManifest(), "skills", "grill-me", false);
  saveManifest(path, manifest);
  assert.equal(loadManifest(path).skills["grill-me"].enabled, false);
});
