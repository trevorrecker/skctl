import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { compileSkill, planSurfaces, variantSurfaces } from "./compile.js";
import { ensureSymlink, pathPresent } from "./fsx.js";
import { readersOf } from "../providers/index.js";
import { AllSurfaces } from "./types.js";
import type { Action, Host, Surface } from "./types.js";
import type { CompiledSkill } from "./compile.js";
import type { Overlay } from "./overlays.js";

export interface SkillBuild {
  name: string;
  surfaces: Surface[];
  spill: Host[];
  compiled: Map<Surface, CompiledSkill>;
}

const skillFile = "SKILL.md";

const isWithin = (root: string, path: string): boolean => {
  const fromRoot = relative(root, path);
  return (
    fromRoot === "" ||
    (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  );
};

const bundledFileProblem = (sourceDir: string, entryPath: string): string | undefined => {
  try {
    const sourceRoot = realpathSync(sourceDir);
    const visited = new Set<string>();
    const inspect = (path: string): string | undefined => {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(path);
        if (!isWithin(sourceRoot, target)) return "bundled link leaves the skill directory";
        return inspect(target);
      }
      if (!stat.isDirectory()) return undefined;
      const realPath = realpathSync(path);
      if (visited.has(realPath)) return undefined;
      visited.add(realPath);
      for (const entry of readdirSync(path)) {
        const problem = inspect(join(path, entry));
        if (problem !== undefined) return problem;
      }
      return undefined;
    };
    return inspect(entryPath);
  } catch {
    return "bundled link is dangling or unreadable";
  }
};

export const planSkillBuild = (
  name: string,
  sourceDir: string,
  hosts: readonly Host[],
  overlay?: Overlay,
): SkillBuild => {
  const sourcePath = join(sourceDir, skillFile);
  const problem = bundledFileProblem(sourceDir, sourcePath);
  if (problem !== undefined) throw new Error(`${sourcePath}: ${problem}`);
  const source = readFileSync(sourcePath, "utf-8");
  const { surfaces, spill } = planSurfaces(hosts, variantSurfaces(source, overlay));
  return {
    name,
    surfaces,
    spill,
    compiled: new Map(
      surfaces.map((surface) => [surface, compileSkill(name, source, surface, overlay)]),
    ),
  };
};

const writeFile = (dest: string, content: string, dryRun: boolean): Action => {
  const exists = existsSync(dest);
  if (exists && readFileSync(dest, "utf-8") === content) {
    return { kind: "ok", detail: dest };
  }
  if (!dryRun) writeFileSync(dest, content, "utf-8");
  return { kind: exists ? "replaced" : "created", detail: dest };
};

// Only SKILL.md is compiled. Every sibling links back to source so a bundled script stays
// editable in one place and ${CLAUDE_SKILL_DIR} still resolves to something complete.
const mirrorSiblings = (
  sourceDir: string,
  buildSkillDir: string,
  dryRun: boolean,
): Action[] => {
  const siblings = readdirSync(sourceDir).filter((entry) => entry !== skillFile);
  const actions: Action[] = [];
  const mirrored: string[] = [];
  for (const entry of siblings) {
    const source = join(sourceDir, entry);
    const destination = join(buildSkillDir, entry);
    const problem = bundledFileProblem(sourceDir, source);
    if (problem === undefined) {
      actions.push(ensureSymlink(destination, source, dryRun));
      mirrored.push(entry);
      continue;
    }
    if (!dryRun && pathPresent(destination)) {
      rmSync(destination, { recursive: true, force: true });
    }
    actions.push({ kind: "conflict", detail: source, note: problem });
  }
  if (!existsSync(buildSkillDir)) return actions;
  const keep = new Set([skillFile, ...mirrored]);
  for (const entry of readdirSync(buildSkillDir)) {
    if (keep.has(entry)) continue;
    if (!dryRun) rmSync(join(buildSkillDir, entry), { recursive: true, force: true });
    actions.push({ kind: "removed", detail: join(buildSkillDir, entry), note: "stale" });
  }
  return actions;
};

export const writeSkillBuild = (
  buildDir: string,
  build: SkillBuild,
  sourceDir: string,
  dryRun: boolean,
): Action[] =>
  build.surfaces.flatMap((surface) => {
    const buildSkillDir = join(buildDir, surface, build.name);
    const compiled = build.compiled.get(surface);
    if (compiled === undefined) return [];
    if (!dryRun) mkdirSync(buildSkillDir, { recursive: true });
    return [
      writeFile(join(buildSkillDir, skillFile), compiled.content, dryRun),
      ...mirrorSiblings(sourceDir, buildSkillDir, dryRun),
    ];
  });

export const pruneBuild = (
  buildDir: string,
  built: Map<Surface, Set<string>>,
  dryRun: boolean,
): Action[] => {
  const actions: Action[] = [];
  for (const surface of AllSurfaces) {
    const dir = join(buildDir, surface);
    if (!existsSync(dir)) continue;
    const keep = built.get(surface) ?? new Set<string>();
    for (const entry of readdirSync(dir)) {
      if (keep.has(entry)) continue;
      if (!dryRun) rmSync(join(dir, entry), { recursive: true, force: true });
      actions.push({
        kind: "removed",
        detail: join(dir, entry),
        subject: entry,
        note: `no longer built for ${surface}`,
      });
    }
  }
  return actions;
};

// OpenCode and Cursor read the compatibility directories, so a skill built for more than one
// surface shows up more than once for them. That much is true of nearly every skill and has
// always been, so only a body that differs is worth reporting: that is the case where the
// client could follow the wrong copy, and no client documents which one wins.
export const divergentBodies = (build: SkillBuild): Action[] => {
  const byHost = new Map<Host, Set<string>>();
  for (const surface of build.surfaces) {
    const body = build.compiled.get(surface)?.body;
    if (body === undefined) continue;
    for (const host of readersOf(surface)) {
      byHost.set(host, (byHost.get(host) ?? new Set()).add(body));
    }
  }
  return [...byHost.entries()]
    .filter(([, bodies]) => bodies.size > 1)
    .map(([host, bodies]): Action => ({
      kind: "conflict",
      subject: build.name,
      detail: `${host} reads ${bodies.size} variants whose instructions differ`,
      note: "no client documents precedence across compatibility directories",
    }));
};
