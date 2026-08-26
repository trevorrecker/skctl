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
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolveSkillPaths } from "./paths.js";
import { defaultManifest } from "./manifest.js";
import {
  addRemote,
  detachRemoteSkill,
  discoverRemoteCatalog,
  discoverRemoteSkills,
  listRemotes,
  pruneSkillEntries,
  remoteAlias,
  removeRemote,
  resolveRemoteSkills,
  updateRoot,
  updateRemotes,
} from "./remotes.js";
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
    assert.ok(lstatSync(join(paths.surfaceDirs.agents, name)).isSymbolicLink());
    assert.ok(existsSync(join(paths.surfaceDirs.claude, name, "SKILL.md")));
  }
  assert.equal(existsSync(join(paths.surfaceDirs.agents, "unwanted")), false);
});

test("unmasking a remote skill prunes its links", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-remote-"));
  seedRemoteClone(home, "pocock", ["wayfinder", "grilling"]);
  const paths = resolveSkillPaths(home);
  mkdirSync(paths.sourceSkills, { recursive: true });

  sync(paths, remoteManifest("pocock", ["wayfinder", "grilling"]), false);
  sync(paths, remoteManifest("pocock", ["wayfinder"]), false);

  assert.ok(existsSync(join(paths.surfaceDirs.agents, "wayfinder")));
  assert.equal(existsSync(join(paths.surfaceDirs.agents, "grilling")), false);
  assert.equal(existsSync(join(paths.surfaceDirs.claude, "grilling")), false);
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
  const target = join(paths.surfaceDirs.agents, "grilling");
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

test("updateRoot fast-forwards a clean skills root", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-root-"));
  const upstream = join(home, "upstream");
  const root = join(home, "skills-root");
  mkdirSync(upstream, { recursive: true });
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  const git = (dir: string, ...args: string[]): void => {
    execFileSync("git", ["-C", dir, ...args], { env });
  };
  git(upstream, "init", "--quiet");
  writeFileSync(join(upstream, "README.md"), "one\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "--quiet", "-m", "seed");
  execFileSync("git", ["clone", "--quiet", upstream, root], { env });
  writeFileSync(join(upstream, "README.md"), "two\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "--quiet", "-m", "update");

  const action = updateRoot(resolveSkillPaths(home, root));

  assert.equal(action.kind, "replaced");
  assert.equal(
    readFileSync(join(root, "README.md"), "utf-8").replaceAll("\r\n", "\n"),
    "two\n",
  );
  writeFileSync(join(root, "local.txt"), "dirty\n");
  assert.equal(updateRoot(resolveSkillPaths(home, root)).kind, "conflict");
});

test("detachRemoteSkill copies the current remote skill and removes its mask", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-remote-"));
  seedRemoteClone(home, "pocock", ["wayfinder", "grilling"]);
  const paths = resolveSkillPaths(home);
  const manifest = remoteManifest("pocock", ["wayfinder", "grilling"]);

  const result = detachRemoteSkill(paths, manifest, "wayfinder", false);

  assert.equal(result.action.kind, "created");
  assert.ok(existsSync(join(paths.sourceSkills, "wayfinder", "SKILL.md")));
  assert.deepEqual(result.manifest.remotes.pocock.skills, ["grilling"]);
  assert.equal(
    detachRemoteSkill(paths, result.manifest, "wayfinder", false).action.kind,
    "conflict",
  );
});

test("detachRemoteSkill refuses duplicate qualified selections with the same name", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-remote-"));
  const paths = resolveSkillPaths(home);
  seedPluginClone(home, "plugins", [
    "one/skills/shared",
    "two/skills/shared",
  ]);
  const manifest = remoteManifest("plugins", ["one/shared", "two/shared"]);

  const result = detachRemoteSkill(paths, manifest, "shared", false);

  assert.equal(result.action.kind, "conflict");
  assert.deepEqual(result.manifest, manifest);
  assert.equal(existsSync(join(paths.sourceSkills, "shared")), false);
});

test("remoteAlias derives a kebab-case alias from common url shapes", () => {
  assert.equal(remoteAlias("https://github.com/owner/skill-pack"), "skill-pack");
  assert.equal(remoteAlias("https://github.com/mattpocock/skills.git"), "skills");
  assert.equal(remoteAlias("git@github.com:owner/My_Repo.git"), "my-repo");
  assert.equal(remoteAlias("https://example.com/repo/"), "repo");
  assert.equal(remoteAlias("/tmp/local-source"), "local-source");
  assert.equal(remoteAlias("C:\\work\\local-source"), "local-source");
});

test("discoverRemoteSkills finds skills at any depth", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-discover-"));
  seedRemoteClone(home, "deep", ["alpha", "beta"]);
  const clone = join(resolveSkillPaths(home).remotesDir, "deep");

  assert.deepEqual(discoverRemoteSkills(clone), ["alpha", "beta"]);
  assert.deepEqual(discoverRemoteSkills(join(clone, "missing")), []);
});

test("discoverRemoteSkills does not stop at an arbitrary nesting depth", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-discover-"));
  const clone = join(resolveSkillPaths(home).remotesDir, "deep");
  const skillDir = join(
    clone,
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "deep-skill",
  );
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: deep-skill\n---\n\nbody\n");

  assert.deepEqual(discoverRemoteSkills(clone), ["deep-skill"]);
});

const seedPluginClone = (home: string, alias: string, skillPaths: string[]): string => {
  const clone = join(resolveSkillPaths(home).remotesDir, alias);
  for (const path of skillPaths) {
    const dir = join(clone, path);
    mkdirSync(dir, { recursive: true });
    const name = path.slice(path.lastIndexOf("/") + 1);
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n\nbody\n`);
  }
  return clone;
};

const writePluginManifest = (
  clone: string,
  group: string,
  manifestDir: string,
  body: string,
): void => {
  const dir = join(clone, group, manifestDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), body);
};

test("resolveRemoteSkills qualifies duplicate skill names by path", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-qualified-"));
  const paths = resolveSkillPaths(home);
  const clone = seedPluginClone(home, "plugins", [
    "pstack/skills/unslop",
    "pstack/skills/bro",
    "third_party/github/skills/unslop",
  ]);

  const resolution = resolveRemoteSkills(
    paths,
    remoteManifest("plugins", [
      "pstack/unslop",
      "third_party/github/skills/unslop",
      "skills/bro",
    ]),
  );

  assert.deepEqual(resolution.problems, []);
  assert.deepEqual(
    resolution.skills.map((skill) => skill.sourceDir),
    [
      join(clone, "pstack", "skills", "unslop"),
      join(clone, "third_party", "github", "skills", "unslop"),
      join(clone, "pstack", "skills", "bro"),
    ],
  );
  assert.deepEqual(
    resolution.skills.map((skill) => skill.name),
    ["unslop", "unslop", "bro"],
  );
  assert.deepEqual(
    resolution.skills.map((skill) => skill.group?.path),
    ["pstack", "third_party/github", "pstack"],
  );
  assert.equal(
    resolveRemoteSkills(paths, remoteManifest("plugins", ["bro"])).skills[0]?.path,
    "pstack/skills/bro",
  );
});

test("resolveRemoteSkills names the candidates behind an ambiguous bare selector", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-ambiguous-"));
  const paths = resolveSkillPaths(home);
  seedPluginClone(home, "plugins", [
    "pstack/skills/unslop",
    "third_party/github/skills/unslop",
  ]);

  const resolution = resolveRemoteSkills(paths, remoteManifest("plugins", ["unslop"]));

  assert.deepEqual(resolution.skills, []);
  assert.equal(resolution.problems.length, 1);
  assert.match(resolution.problems[0].detail, /2 skills matching 'unslop'/);
  assert.match(resolution.problems[0].note ?? "", /pstack\/unslop/);
  assert.match(resolution.problems[0].note ?? "", /github\/unslop/);
});

test("discoverRemoteCatalog qualifies each skill and reads its plugin manifest", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-catalog-"));
  const clone = seedPluginClone(home, "plugins", [
    "pstack/skills/unslop",
    "third_party/github/skills/unslop",
    "broken/skills/loose",
    "plain/skills/tidy",
  ]);
  writePluginManifest(
    clone,
    "pstack",
    ".cursor-plugin",
    JSON.stringify({ name: "pstack", displayName: "PStack", description: "prompt stack" }),
  );
  writePluginManifest(
    clone,
    "third_party/github",
    ".claude-plugin",
    JSON.stringify({ name: "github" }),
  );
  writePluginManifest(clone, "broken", ".cursor-plugin", "{ not json");

  const catalog = discoverRemoteCatalog(clone, ["pstack/unslop"]);
  const byPath = new Map(catalog.map((entry) => [entry.path, entry]));

  assert.deepEqual(
    catalog.map((entry) => entry.path),
    [
      "broken/skills/loose",
      "plain/skills/tidy",
      "pstack/skills/unslop",
      "third_party/github/skills/unslop",
    ],
  );
  assert.deepEqual(byPath.get("pstack/skills/unslop")?.group, {
    path: "pstack",
    name: "PStack",
    description: "prompt stack",
  });
  assert.equal(byPath.get("pstack/skills/unslop")?.selected, true);
  assert.equal(byPath.get("pstack/skills/unslop")?.selector, "pstack/unslop");
  assert.equal(byPath.get("third_party/github/skills/unslop")?.group?.name, "github");
  assert.equal(byPath.get("third_party/github/skills/unslop")?.group?.description, undefined);
  assert.equal(byPath.get("third_party/github/skills/unslop")?.selected, false);
  assert.equal(byPath.get("third_party/github/skills/unslop")?.selector, "github/unslop");
  assert.deepEqual(byPath.get("broken/skills/loose")?.group, { path: "broken" });
  assert.deepEqual(byPath.get("plain/skills/tidy")?.group, { path: "plain" });
  assert.deepEqual(discoverRemoteSkills(clone), ["loose", "tidy", "unslop"]);
});

test("listRemotes reports the qualified catalog beside the flat name list", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-catalog-list-"));
  const paths = resolveSkillPaths(home);
  seedPluginClone(home, "plugins", [
    "pstack/skills/unslop",
    "third_party/github/skills/unslop",
  ]);

  const [info] = listRemotes(paths, remoteManifest("plugins", ["pstack/unslop"]));

  assert.deepEqual(info.available, ["github/unslop", "pstack/unslop"]);
  assert.deepEqual(
    info.available.filter((selector) => !info.skills.includes(selector)),
    ["github/unslop"],
  );
  assert.deepEqual(
    info.catalog.filter((entry) => entry.selected).map((entry) => entry.path),
    ["pstack/skills/unslop"],
  );
  assert.deepEqual(
    info.catalog.map((entry) => entry.group?.path),
    ["pstack", "third_party/github"],
  );
});

test("addRemote qualifies selections from an existing tracked clone", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-add-qualified-"));
  const paths = resolveSkillPaths(home);
  seedPluginClone(home, "plugins", [
    "pstack/skills/bro",
    "pstack/skills/unslop",
    "third_party/github/skills/unslop",
  ]);
  const url = "https://example.com/plugins.git";
  const manifest: SkillsManifest = {
    ...defaultManifest(),
    remotes: { plugins: { url, skills: [] } },
  };

  const added = addRemote(paths, manifest, url, { alias: "plugins" });
  assert.equal(added.action.kind, "ok");
  assert.deepEqual(added.selected, ["bro", "github/unslop", "pstack/unslop"]);
  assert.deepEqual(resolveRemoteSkills(paths, added.manifest).problems, []);

  const ambiguous = addRemote(paths, manifest, url, {
    alias: "plugins",
    skills: ["unslop"],
  });
  assert.equal(ambiguous.action.kind, "conflict");
  assert.match(ambiguous.action.detail, /matches 2 skills/);
  assert.match(ambiguous.action.note ?? "", /pstack\/unslop/);

  const picked = addRemote(paths, manifest, url, {
    alias: "plugins",
    skills: ["github/unslop"],
  });
  assert.deepEqual(picked.selected, ["github/unslop"]);
  assert.deepEqual(picked.manifest.remotes.plugins.skills, ["github/unslop"]);
});

const seedUpstream = (home: string, skillNames: string[], dir = "upstream"): string => {
  const upstream = join(home, dir);
  mkdirSync(upstream, { recursive: true });
  writeFileSync(join(upstream, "README.md"), "seed\n");
  for (const name of skillNames) {
    const dir = join(upstream, "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n\nbody\n`);
  }
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  execFileSync("git", ["-C", upstream, "init", "--quiet"], { env });
  execFileSync("git", ["-C", upstream, "add", "."], { env });
  execFileSync("git", ["-C", upstream, "commit", "--quiet", "-m", "seed"], { env });
  return upstream;
};

test("addRemote clones, selects every discovered skill, and derives an alias", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-add-"));
  const upstream = seedUpstream(home, ["alpha", "beta"]);
  const paths = resolveSkillPaths(home, join(home, "root"));

  const result = addRemote(paths, defaultManifest(), upstream);

  assert.equal(result.action.kind, "created");
  assert.equal(result.alias, "upstream");
  assert.deepEqual(result.available, ["alpha", "beta"]);
  assert.deepEqual(result.selected, ["alpha", "beta"]);
  assert.deepEqual(result.manifest.remotes.upstream, {
    url: upstream,
    skills: ["alpha", "beta"],
  });
  assert.ok(existsSync(join(paths.remotesDir, "upstream", "skills", "alpha", "SKILL.md")));
});

test("addRemote force-replaces a changed origin only after the new clone succeeds", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-add-"));
  const firstUpstream = seedUpstream(home, ["alpha"], "first-upstream");
  const secondUpstream = seedUpstream(home, ["beta"], "second-upstream");
  const paths = resolveSkillPaths(home, join(home, "root"));
  const first = addRemote(paths, defaultManifest(), firstUpstream, { alias: "fixture" });

  const failed = addRemote(paths, first.manifest, join(home, "missing"), {
    alias: "fixture",
    force: true,
  });
  assert.equal(failed.action.kind, "conflict");
  assert.ok(existsSync(join(paths.remotesDir, "fixture", "skills", "alpha", "SKILL.md")));

  const replaced = addRemote(paths, first.manifest, secondUpstream, {
    alias: "fixture",
    force: true,
  });

  assert.equal(replaced.action.kind, "replaced");
  assert.deepEqual(replaced.available, ["beta"]);
  assert.equal(replaced.manifest.remotes.fixture?.url, secondUpstream);
  assert.equal(existsSync(join(paths.remotesDir, "fixture", "skills", "alpha")), false);
  assert.ok(existsSync(join(paths.remotesDir, "fixture", "skills", "beta", "SKILL.md")));
  assert.equal(
    execFileSync("git", ["-C", join(paths.remotesDir, "fixture"), "remote", "get-url", "origin"], {
      encoding: "utf-8",
    }).trim(),
    secondUpstream,
  );
});

test("addRemote narrows the selection and reports names the remote lacks", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-add-"));
  const upstream = seedUpstream(home, ["alpha", "beta", "gamma"]);
  const paths = resolveSkillPaths(home, join(home, "root"));

  const narrowed = addRemote(paths, defaultManifest(), upstream, {
    alias: "fixture",
    skills: ["alpha"],
  });
  assert.deepEqual(narrowed.selected, ["alpha"]);
  assert.deepEqual(narrowed.available, ["alpha", "beta", "gamma"]);

  const missing = addRemote(paths, defaultManifest(), upstream, {
    alias: "other",
    skills: ["nope"],
  });
  assert.equal(missing.action.kind, "conflict");
  assert.match(missing.action.detail, /no skill named nope/);
  assert.equal(existsSync(join(paths.remotesDir, "other")), false);
});

test("addRemote refuses a taken alias and rejects a repository with no skills", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-add-"));
  const upstream = seedUpstream(home, ["alpha"]);
  const paths = resolveSkillPaths(home, join(home, "root"));
  const taken = addRemote(paths, defaultManifest(), upstream, { alias: "fixture" });

  const clash = addRemote(paths, taken.manifest, "https://example.com/other.git", {
    alias: "fixture",
  });
  assert.equal(clash.action.kind, "conflict");
  assert.match(clash.action.detail, /already tracks/);

  const bare = seedUpstream(home, [], "bare-upstream");
  const empty = addRemote(paths, defaultManifest(), bare, { alias: "bare" });
  assert.equal(empty.action.kind, "conflict");
  assert.match(empty.action.detail, /no SKILL.md/);
  assert.equal(existsSync(join(paths.remotesDir, "bare")), false);
});

test("remote operations reject aliases that escape the remotes directory", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-alias-"));
  const paths = resolveSkillPaths(home, join(home, "root"));
  const outside = join(paths.sourceRepo, "outside");
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "keep.txt"), "keep\n");
  const manifest: SkillsManifest = {
    ...defaultManifest(),
    remotes: { "../outside": { url: "https://example.test/repo.git", skills: [] } },
  };

  const added = addRemote(paths, defaultManifest(), "https://example.test/repo.git", {
    alias: "../outside",
  });
  const updated = updateRemotes(paths, manifest);
  const removed = removeRemote(paths, manifest, "../outside", false);

  assert.equal(added.action.kind, "conflict");
  assert.equal(updated[0]?.kind, "conflict");
  assert.equal(removed.action.kind, "conflict");
  assert.equal(readFileSync(join(outside, "keep.txt"), "utf-8"), "keep\n");
});

test("removeRemote drops the clone, the entry, and selections it alone supplied", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-remove-"));
  const upstream = seedUpstream(home, ["alpha", "beta"]);
  const paths = resolveSkillPaths(home, join(home, "root"));
  const added = addRemote(paths, defaultManifest(), upstream, { alias: "fixture" });
  const manifest: SkillsManifest = {
    ...added.manifest,
    skills: { alpha: { hosts: ["claude"] }, beta: {}, local: {} },
  };

  const planned = removeRemote(paths, manifest, "fixture", true);
  assert.equal(planned.action.kind, "removed");
  assert.ok(existsSync(join(paths.remotesDir, "fixture")));

  const removed = removeRemote(paths, manifest, "fixture", false);
  assert.equal(existsSync(join(paths.remotesDir, "fixture")), false);
  assert.deepEqual(Object.keys(removed.manifest.remotes), []);
  assert.deepEqual(Object.keys(removed.manifest.skills), ["local"]);
  assert.equal(removeRemote(paths, removed.manifest, "fixture", false).action.kind, "conflict");
});

test("listRemotes reports what a clone offers beyond the selection", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-list-"));
  seedRemoteClone(home, "pocock", ["wayfinder", "grilling", "spare"]);
  const paths = resolveSkillPaths(home);

  const [info] = listRemotes(paths, remoteManifest("pocock", ["wayfinder"]));

  assert.deepEqual(info.skills, ["wayfinder"]);
  assert.deepEqual(info.available, ["grilling", "spare", "wayfinder"]);
  assert.equal(info.cloned, true);
});

test("pruneSkillEntries drops an entry for a deselected skill and keeps the rest", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-prune-"));
  const paths = resolveSkillPaths(home, join(home, "root"));
  mkdirSync(join(paths.sourceSkills, "mine"), { recursive: true });
  writeFileSync(join(paths.sourceSkills, "mine", "SKILL.md"), "---\nname: mine\n---\n");
  const manifest: SkillsManifest = {
    ...defaultManifest(),
    remotes: { fixture: { url: "https://example.test/repo", skills: ["kept"] } },
    skills: {
      kept: { tags: ["work"] },
      dropped: { tags: ["work"] },
      mine: { enabled: false },
      elsewhere: { tags: ["stale"] },
    },
  };

  const pruned = pruneSkillEntries(paths, manifest, ["group/dropped"]);

  assert.deepEqual(Object.keys(pruned.skills).sort(), ["elsewhere", "kept", "mine"]);
});

test("pruneSkillEntries keeps a deselected skill that another remote still supplies", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-prune-"));
  const paths = resolveSkillPaths(home, join(home, "root"));
  const manifest: SkillsManifest = {
    ...defaultManifest(),
    remotes: {
      one: { url: "https://example.test/one", skills: [] },
      two: { url: "https://example.test/two", skills: ["shared"] },
    },
    skills: { shared: { tags: ["work"] } },
  };

  const pruned = pruneSkillEntries(paths, manifest, ["shared"]);

  assert.deepEqual(Object.keys(pruned.skills), ["shared"]);
});
