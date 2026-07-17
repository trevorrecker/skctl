import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { resolveSkillPaths } from "./paths.js";
import { defaultManifest } from "./manifest.js";
import { listRemotes, resolveRemoteSkills, updateRemotes } from "./remotes.js";
import { sync } from "./sync.js";
import type { SkillsManifest } from "./types.js";

const seedRemoteClone = (home: string, alias: string, skillNames: string[]): void => {
  const paths = resolveSkillPaths(home);
  for (const name of skillNames) {
    const dir = join(paths.remotesDir, alias, "skills", "engineering", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: remote demo\n---\n\nbody\n`,
    );
  }
};

const remoteManifest = (alias: string, skills: string[]): SkillsManifest => ({
  ...defaultManifest(),
  remotes: { [alias]: { url: "https://example.com/repo.git", skills } },
});

test("sync links masked remote skills and skips unmasked ones", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-remote-"));
  seedRemoteClone(home, "pocock", ["wayfinder", "grilling", "unwanted"]);
  const paths = resolveSkillPaths(home);
  mkdirSync(paths.sourceSkills, { recursive: true });

  sync(paths, remoteManifest("pocock", ["wayfinder", "grilling"]), false);

  for (const name of ["wayfinder", "grilling"]) {
    assert.ok(lstatSync(join(paths.agentsSkills, name)).isSymbolicLink());
    assert.ok(existsSync(join(paths.claudeSkills, name, "SKILL.md")));
  }
  assert.equal(existsSync(join(paths.agentsSkills, "unwanted")), false);
});

test("unmasking a remote skill prunes its links", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-remote-"));
  seedRemoteClone(home, "pocock", ["wayfinder", "grilling"]);
  const paths = resolveSkillPaths(home);
  mkdirSync(paths.sourceSkills, { recursive: true });

  sync(paths, remoteManifest("pocock", ["wayfinder", "grilling"]), false);
  sync(paths, remoteManifest("pocock", ["wayfinder"]), false);

  assert.ok(existsSync(join(paths.agentsSkills, "wayfinder")));
  assert.equal(existsSync(join(paths.agentsSkills, "grilling")), false);
  assert.equal(existsSync(join(paths.claudeSkills, "grilling")), false);
});

test("a local skill shadows the remote one with a conflict", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-remote-"));
  seedRemoteClone(home, "pocock", ["grilling"]);
  const paths = resolveSkillPaths(home);
  const local = join(paths.sourceSkills, "grilling");
  mkdirSync(local, { recursive: true });
  writeFileSync(join(local, "SKILL.md"), "---\nname: grilling\n---\n\nlocal\n");

  const report = sync(paths, remoteManifest("pocock", ["grilling"]), false);

  const conflict = report.skills.find((action) => action.kind === "conflict");
  assert.match(conflict?.detail ?? "", /shadows remote 'pocock'/);
  const target = join(paths.agentsSkills, "grilling");
  assert.ok(lstatSync(target).isSymbolicLink());
  assert.ok(existsSync(join(target, "SKILL.md")));
});

test("resolveRemoteSkills reports missing clones and unknown mask names", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-remote-"));
  const paths = resolveSkillPaths(home);

  const missing = resolveRemoteSkills(paths, remoteManifest("pocock", ["wayfinder"]));
  assert.equal(missing.skills.length, 0);
  assert.match(missing.problems[0]?.detail ?? "", /not cloned/);

  seedRemoteClone(home, "pocock", ["wayfinder"]);
  const unknown = resolveRemoteSkills(paths, remoteManifest("pocock", ["nope"]));
  assert.match(unknown.problems[0]?.detail ?? "", /no skill 'nope'/);
});

test("listRemotes reports masks and clone state", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-remote-"));
  const paths = resolveSkillPaths(home);
  const manifest = remoteManifest("pocock", ["wayfinder", "grilling"]);

  const before = listRemotes(paths, manifest);
  assert.equal(before[0].alias, "pocock");
  assert.equal(before[0].skills.length, 2);
  assert.equal(before[0].cloned, false);

  seedRemoteClone(home, "pocock", ["wayfinder"]);
  assert.equal(listRemotes(paths, manifest)[0].cloned, true);
});

test("updateRemotes clones a missing remote and reports up to date on re-run", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-remote-"));
  const paths = resolveSkillPaths(home);
  const upstream = mkdtempSync(join(tmpdir(), "skctl-upstream-"));
  const skillDir = join(upstream, "skills", "wayfinder");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: wayfinder\n---\n\nbody\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", upstream, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
  git("init", "--quiet");
  git("add", ".");
  git("commit", "--quiet", "-m", "seed");

  const manifest: SkillsManifest = {
    ...defaultManifest(),
    remotes: { pocock: { url: upstream, skills: ["wayfinder"] } },
  };
  const first = updateRemotes(paths, manifest);
  assert.equal(first[0]?.kind, "created");
  assert.ok(existsSync(join(paths.remotesDir, "pocock", "skills", "wayfinder", "SKILL.md")));

  const second = updateRemotes(paths, manifest);
  assert.equal(second[0]?.kind, "ok");

  const unknown = updateRemotes(paths, manifest, "nope");
  assert.equal(unknown[0]?.kind, "conflict");
});
