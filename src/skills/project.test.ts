import test from "node:test";
import assert from "node:assert/strict";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolveProjectTarget, resolveSkillPaths } from "./paths.js";
import {
  defaultManifest,
  loadManifest,
  saveManifest,
  setEnabled,
  setHosts,
  setTags,
} from "./manifest.js";
import {
  loadProjectConfig,
  reconcileProject,
  removeProject,
  saveProjectConfig,
} from "./project.js";
import type { ProjectConfig } from "./project.js";
import type { Surface } from "./types.js";

const projectModes: ProjectConfig["mode"][] = ["link", "copy"];
const sharedSurfaces: Surface[] = ["claude", "agents"];

const skill = (dir: string, name: string, body = "body"): void => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(
    join(dir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} does things\npaste: true\n---\n\n${body}\n`,
  );
};

const globalRoot = (): ReturnType<typeof resolveSkillPaths> => {
  const home = mkdtempSync(join(tmpdir(), "skctl-project-global-"));
  const paths = resolveSkillPaths(home);
  mkdirSync(paths.sourceSkills, { recursive: true });
  skill(paths.sourceSkills, "work-tool");
  skill(paths.sourceSkills, "personal-tool");
  skill(paths.sourceSkills, "picked-by-name");
  let manifest = setTags(defaultManifest(), "work-tool", ["work"]);
  manifest = setTags(manifest, "personal-tool", ["personal"]);
  saveManifest(paths.manifestPath, manifest);
  return paths;
};

const config = (from: string, over: Partial<ProjectConfig> = {}): ProjectConfig => ({
  from,
  tags: [],
  skills: [],
  mode: "link",
  ...over,
});

test("a tag selector projects only the skills carrying that tag", () => {
  const paths = globalRoot();
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));

  const report = reconcileProject(
    paths,
    target,
    config(paths.sourceRepo, { tags: ["work"] }),
    false,
  );

  assert.deepEqual(report.selected, ["work-tool"]);
  assert.ok(existsSync(join(target.surfaceDirs.claude, "work-tool", "SKILL.md")));
  assert.equal(existsSync(join(target.surfaceDirs.claude, "personal-tool")), false);
});

test("a name selector and a tag selector both contribute", () => {
  const paths = globalRoot();
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));

  const report = reconcileProject(
    paths,
    target,
    config(paths.sourceRepo, { tags: ["work"], skills: ["picked-by-name"] }),
    false,
  );

  assert.deepEqual(report.selected, ["picked-by-name", "work-tool"]);
});

test("link mode leaves symlinks into the project build and compiles the skill", () => {
  const paths = globalRoot();
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));

  reconcileProject(paths, target, config(paths.sourceRepo, { skills: ["work-tool"] }), false);

  const link = join(target.surfaceDirs.claude, "work-tool");
  assert.ok(lstatSync(link).isSymbolicLink());
  const compiled = readFileSync(join(link, "SKILL.md"), "utf-8");
  assert.match(compiled, /name: work-tool/);
  assert.doesNotMatch(compiled, /paste/);
});

test("copy mode writes real directories, records them, and drops the staging build", () => {
  const paths = globalRoot();
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));

  const report = reconcileProject(
    paths,
    target,
    config(paths.sourceRepo, { skills: ["work-tool"], mode: "copy" }),
    false,
  );

  const copied = join(target.surfaceDirs.claude, "work-tool");
  assert.equal(lstatSync(copied).isSymbolicLink(), false);
  assert.ok(existsSync(join(copied, "SKILL.md")));
  assert.equal(existsSync(target.buildDir), false);
  assert.ok(report.config.written?.includes(".claude/skills/work-tool"));
  assert.ok(report.config.written?.includes(".agents/skills/work-tool"));
});

test("narrowing the selector prunes what it dropped, in either mode", () => {
  for (const mode of projectModes) {
    const paths = globalRoot();
    const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));

    const first = reconcileProject(
      paths,
      target,
      config(paths.sourceRepo, { skills: ["work-tool", "picked-by-name"], mode }),
      false,
    );
    assert.ok(existsSync(join(target.surfaceDirs.claude, "picked-by-name")), mode);

    reconcileProject(
      paths,
      target,
      { ...first.config, skills: ["work-tool"] },
      false,
    );

    assert.ok(existsSync(join(target.surfaceDirs.claude, "work-tool")), mode);
    assert.equal(existsSync(join(target.surfaceDirs.claude, "picked-by-name")), false, mode);
  }
});

test("copy mode prunes a skill from surfaces it no longer targets", () => {
  const paths = globalRoot();
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));
  const first = reconcileProject(
    paths,
    target,
    config(paths.sourceRepo, { skills: ["work-tool"], mode: "copy" }),
    false,
  );
  saveManifest(
    paths.manifestPath,
    setHosts(loadManifest(paths.manifestPath), "skills", "work-tool", ["cursor"]),
  );

  const second = reconcileProject(paths, target, first.config, false);

  assert.equal(existsSync(join(target.surfaceDirs.claude, "work-tool")), false);
  assert.equal(existsSync(join(target.surfaceDirs.agents, "work-tool")), false);
  assert.ok(existsSync(join(target.surfaceDirs.cursor, "work-tool", "SKILL.md")));
  assert.deepEqual(second.config.written, [".cursor/skills/work-tool"]);
});

test("link mode prunes a skill from surfaces it no longer targets", () => {
  const paths = globalRoot();
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));
  const selection = config(paths.sourceRepo, { skills: ["work-tool"] });
  reconcileProject(paths, target, selection, false);
  saveManifest(
    paths.manifestPath,
    setHosts(loadManifest(paths.manifestPath), "skills", "work-tool", ["cursor"]),
  );

  reconcileProject(paths, target, selection, false);

  assert.equal(existsSync(join(target.surfaceDirs.claude, "work-tool")), false);
  assert.equal(existsSync(join(target.surfaceDirs.agents, "work-tool")), false);
  assert.ok(existsSync(join(target.surfaceDirs.cursor, "work-tool", "SKILL.md")));
});

test("reconcile leaves a hand-written skill in the project alone", () => {
  const paths = globalRoot();
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));
  skill(target.surfaceDirs.claude, "hand-written");

  reconcileProject(paths, target, config(paths.sourceRepo, { skills: ["work-tool"] }), false);

  assert.ok(existsSync(join(target.surfaceDirs.claude, "hand-written", "SKILL.md")));
});

test("copy mode reports selected-name collisions without replacing project skills", () => {
  const paths = globalRoot();
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));
  for (const surface of sharedSurfaces) {
    skill(target.surfaceDirs[surface], "work-tool", `${surface} project copy`);
  }

  const report = reconcileProject(
    paths,
    target,
    config(paths.sourceRepo, { skills: ["work-tool"], mode: "copy" }),
    false,
  );

  assert.equal(report.actions.filter((action) => action.kind === "conflict").length, 2);
  assert.equal(report.config.written?.length, 0);
  assert.match(readFileSync(join(target.surfaceDirs.claude, "work-tool", "SKILL.md"), "utf-8"), /claude project copy/);
  assert.match(readFileSync(join(target.surfaceDirs.agents, "work-tool", "SKILL.md"), "utf-8"), /agents project copy/);
});

test("project selectors respect an explicit global disable", () => {
  const paths = globalRoot();
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));
  saveManifest(
    paths.manifestPath,
    setEnabled(loadManifest(paths.manifestPath), "skills", "work-tool", false),
  );

  const report = reconcileProject(
    paths,
    target,
    config(paths.sourceRepo, { tags: ["work"], skills: ["work-tool"] }),
    false,
  );

  assert.deepEqual(report.selected, []);
  assert.equal(existsSync(join(target.surfaceDirs.claude, "work-tool")), false);
});

test("project reconcile ignores only skctl's generated state", () => {
  const paths = globalRoot();
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));
  writeFileSync(target.gitignorePath, "node_modules/\n");

  reconcileProject(paths, target, config(paths.sourceRepo, { skills: ["work-tool"] }), false);

  assert.equal(
    readFileSync(target.gitignorePath, "utf-8"),
    "node_modules/\n\n.agents/.build/\n.agents/skctl.project.json\n",
  );
  assert.doesNotMatch(readFileSync(target.gitignorePath, "utf-8"), /\.agents\/skills/);
});

test("project remove clears the projection and its config, in either mode", () => {
  for (const mode of projectModes) {
    const paths = globalRoot();
    const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));
    const report = reconcileProject(
      paths,
      target,
      config(paths.sourceRepo, { skills: ["work-tool"], mode }),
      false,
    );
    saveProjectConfig(target, report.config);

    removeProject(target, report.config, false);

    assert.equal(existsSync(join(target.surfaceDirs.claude, "work-tool")), false, mode);
    assert.equal(existsSync(target.configPath), false, mode);
    assert.equal(existsSync(target.buildDir), false, mode);
  }
});

test("project cleanup refuses paths outside managed skill directories", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "skctl-project-"));
  const target = resolveProjectTarget(projectRoot);
  const projectFile = join(projectRoot, "README.md");
  const parentFile = join(dirname(projectRoot), `${basename(projectRoot)}-keep.txt`);
  writeFileSync(projectFile, "project\n");
  writeFileSync(parentFile, "parent\n");

  const actions = removeProject(
    target,
    config("/somewhere", {
      mode: "copy",
      written: ["README.md", `../${basename(parentFile)}`],
    }),
    false,
  );

  assert.equal(actions.filter((action) => action.kind === "conflict").length, 2);
  assert.ok(existsSync(projectFile));
  assert.ok(existsSync(parentFile));
});

test("copy mode neither replaces nor strands dangling links", () => {
  const paths = globalRoot();
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));
  const unowned = join(target.surfaceDirs.claude, "work-tool");
  mkdirSync(dirname(unowned), { recursive: true });
  symlinkSync("missing", unowned);

  const report = reconcileProject(
    paths,
    target,
    config(paths.sourceRepo, { skills: ["work-tool"], mode: "copy" }),
    false,
  );

  assert.ok(report.actions.some(
    (action) => action.kind === "conflict" && action.detail === unowned,
  ));
  assert.ok(lstatSync(unowned).isSymbolicLink());

  const owned = join(target.surfaceDirs.cursor, "old-tool");
  mkdirSync(dirname(owned), { recursive: true });
  symlinkSync("missing", owned);
  removeProject(
    target,
    config(paths.sourceRepo, {
      mode: "copy",
      written: [".cursor/skills/old-tool"],
    }),
    false,
  );
  assert.throws(() => lstatSync(owned));
});

test("project reconcile reports unavailable and duplicate selected skill names", () => {
  const paths = globalRoot();
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));
  const clone = join(paths.remotesDir, "plugins");
  skill(join(clone, "one", "skills"), "same");
  skill(join(clone, "two", "skills"), "same");
  saveManifest(paths.manifestPath, {
    ...loadManifest(paths.manifestPath),
    remotes: {
      plugins: {
        url: "https://example.test/plugins.git",
        skills: ["one/same", "two/same"],
      },
    },
  });

  const report = reconcileProject(
    paths,
    target,
    config(paths.sourceRepo, { skills: ["same", "missing"] }),
    false,
  );

  assert.deepEqual(report.selected, []);
  assert.ok(report.actions.some((action) => /2 selected remote skills/.test(action.detail)));
  assert.ok(report.actions.some(
    (action) => action.subject === "missing" && action.detail === "selected skill is not available",
  ));
});

test("a dry run reports without touching the project directory", () => {
  const paths = globalRoot();
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));

  const report = reconcileProject(
    paths,
    target,
    config(paths.sourceRepo, { skills: ["work-tool"] }),
    true,
  );

  assert.ok(report.actions.some((action) => action.kind === "created"));
  assert.equal(existsSync(target.buildDir), false);
  assert.equal(existsSync(join(target.surfaceDirs.claude, "work-tool")), false);
});

test("the project config round trips through disk", () => {
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));
  const written = config("/somewhere/skills", { tags: ["work"], mode: "copy", written: ["a"] });

  saveProjectConfig(target, written);

  assert.deepEqual(loadProjectConfig(target), written);
});

test("a malformed project config reads as absent rather than throwing", () => {
  const target = resolveProjectTarget(mkdtempSync(join(tmpdir(), "skctl-project-")));
  mkdirSync(join(target.root, ".agents"), { recursive: true });
  writeFileSync(target.configPath, "{ not json");

  assert.equal(loadProjectConfig(target), undefined);
});
