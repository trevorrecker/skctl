import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctor } from "./doctor.js";
import { defaultManifest, saveManifest } from "./manifest.js";
import { resolveSkillPaths } from "./paths.js";
import { sync } from "./sync.js";

const directoryLinkType = process.platform === "win32" ? "junction" : "dir";

test("doctor reports managed links that point at the wrong skill build", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-doctor-"));
  const paths = resolveSkillPaths(home);
  const source = join(paths.sourceSkills, "demo");
  mkdirSync(source, { recursive: true });
  writeFileSync(
    join(source, "SKILL.md"),
    "---\nname: demo\ndescription: demo\n---\n\nbody\n",
  );
  saveManifest(paths.manifestPath, defaultManifest());
  sync(paths, defaultManifest(), false);

  const wrongBuild = join(paths.buildDir, "claude", "wrong");
  mkdirSync(wrongBuild, { recursive: true });
  const link = join(paths.surfaceDirs.claude, "demo");
  rmSync(link);
  symlinkSync(wrongBuild, link, directoryLinkType);

  const report = doctor(paths);
  assert.ok(report.issues.some((issue) => issue.label === "drift" && issue.detail === link));
});

test("doctor reports generated state missing from the root ignore file", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-doctor-"));
  const paths = resolveSkillPaths(home);
  mkdirSync(paths.sourceRepo, { recursive: true });
  saveManifest(paths.manifestPath, defaultManifest());
  writeFileSync(paths.gitignorePath, ".build/\n");

  const report = doctor(paths);

  assert.ok(
    report.issues.some(
      (issue) =>
        issue.label === "generated state not ignored" && issue.hint?.includes("remotes/"),
    ),
  );

  sync(paths, defaultManifest(), false);
  const applied = doctor(paths);
  assert.equal(
    applied.issues.some((issue) => issue.label === "generated state not ignored"),
    false,
  );
});
