import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { divergentBodies, planSkillBuild, pruneBuild, writeSkillBuild } from "./build.js";
import { compileCommand, isGeneratedCommand } from "./commands.js";
import { ensureSymlink, removeIfSymlink } from "./fsx.js";
import { loadManifest, resolveEntry } from "./manifest.js";
import { loadOverlays } from "./overlays.js";
import { resolveRemoteSkills } from "./remotes.js";
import { syncInstructions } from "./instructions.js";
import { AllSurfaces } from "./types.js";
import type { Action, ResolvedEntry, SkillsManifest, Surface } from "./types.js";
import type { Overlay } from "./overlays.js";
import type { SkillPaths } from "./paths.js";

export interface SyncReport {
  dryRun: boolean;
  instructions: Action[];
  skills: Action[];
  commands: Action[];
}

const tag = (name: string, action: Action): Action => ({ ...action, subject: name });

export const listSkillNames = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(dir, name, "SKILL.md")))
    .sort();
};

export const listCommandNames = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort();
};

// In project source scope the skills directory is both the source and the surface Codex
// reads, so there is no build to write or link for it. A remote skill in the same scope
// still lives elsewhere and gets the normal treatment.
const surfaceHoldsSource = (
  paths: SkillPaths,
  surface: Surface,
  sourceDir: string,
): boolean => paths.surfaceDirs[surface] === dirname(sourceDir);

const syncSkill = (
  paths: SkillPaths,
  resolved: ResolvedEntry,
  sourceDir: string,
  dryRun: boolean,
  overlay: Overlay | undefined,
  built: Map<Surface, Set<string>>,
): Action[] => {
  const { name } = resolved;
  if (!resolved.enabled) {
    return AllSurfaces.filter((surface) => !surfaceHoldsSource(paths, surface, sourceDir)).map(
      (surface) => tag(name, removeIfSymlink(join(paths.surfaceDirs[surface], name), dryRun)),
    );
  }

  const build = planSkillBuild(name, sourceDir, resolved.hosts, overlay);
  const targets = build.surfaces.filter(
    (surface) => !surfaceHoldsSource(paths, surface, sourceDir),
  );
  const actions: Action[] = [
    ...writeSkillBuild(paths.buildDir, { ...build, surfaces: targets }, sourceDir, dryRun).map(
      (action) => tag(name, action),
    ),
    ...divergentBodies(build),
  ];
  for (const surface of AllSurfaces) {
    if (surfaceHoldsSource(paths, surface, sourceDir)) continue;
    const link = join(paths.surfaceDirs[surface], name);
    if (targets.includes(surface)) {
      built.set(surface, (built.get(surface) ?? new Set()).add(name));
      actions.push(
        tag(name, ensureSymlink(link, join(paths.buildDir, surface, name), dryRun)),
      );
    } else {
      actions.push(tag(name, removeIfSymlink(link, dryRun)));
    }
  }
  return actions;
};

const writeCommandFile = (
  dest: string,
  content: string,
  dryRun: boolean,
): Action => {
  const exists = existsSync(dest);
  if (exists) {
    const current = readFileSync(dest, "utf-8");
    if (current === content) return { kind: "ok", detail: dest };
    if (!isGeneratedCommand(current)) {
      return { kind: "conflict", detail: dest, note: "exists and was not generated" };
    }
  }
  if (!dryRun) {
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, content, "utf-8");
  }
  return { kind: exists ? "replaced" : "created", detail: dest };
};

const removeCommandFile = (dest: string, dryRun: boolean): Action => {
  if (!existsSync(dest)) return { kind: "ok", detail: dest };
  if (!isGeneratedCommand(readFileSync(dest, "utf-8"))) {
    return { kind: "conflict", detail: dest, note: "was not generated, left untouched" };
  }
  if (!dryRun) rmSync(dest);
  return { kind: "removed", detail: dest };
};

const syncCommand = (
  paths: SkillPaths,
  resolved: ResolvedEntry,
  dryRun: boolean,
): Action[] => {
  const { name } = resolved;
  const source = readFileSync(join(paths.sourceCommands, `${name}.md`), "utf-8");
  return paths.commandHosts.map((host) => {
    const dest = join(paths.commandDirs[host], `${name}.md`);
    const wanted = resolved.enabled && resolved.hosts.includes(host);
    return tag(
      `${name}/${host}`,
      wanted
        ? writeCommandFile(dest, compileCommand(name, source, host), dryRun)
        : removeCommandFile(dest, dryRun),
    );
  });
};

const pruneOrphanCommands = (
  paths: SkillPaths,
  sourceNames: Set<string>,
  dryRun: boolean,
): Action[] => {
  const actions: Action[] = [];
  for (const host of paths.commandHosts) {
    const dir = paths.commandDirs[host];
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      if (sourceNames.has(file.slice(0, -3))) continue;
      const full = join(dir, file);
      if (!isGeneratedCommand(readFileSync(full, "utf-8"))) continue;
      if (!dryRun) rmSync(full);
      actions.push({
        kind: "removed",
        detail: full,
        subject: file.slice(0, -3),
        note: "orphaned",
      });
    }
  }
  return actions;
};

const pruneBrokenLinks = (dir: string, dryRun: boolean): Action[] => {
  if (!existsSync(dir)) return [];
  const actions: Action[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink() && !existsSync(path)) {
      if (!dryRun) rmSync(path);
      actions.push({
        kind: "removed",
        detail: path,
        subject: entry.name,
        note: "broken link",
      });
    }
  }
  return actions;
};

const buildIgnoreEntry = ".build/";

export const ensureBuildIgnored = (paths: SkillPaths, dryRun: boolean): Action => {
  const current = existsSync(paths.gitignorePath)
    ? readFileSync(paths.gitignorePath, "utf-8")
    : "";
  if (current.split(/\r?\n/).some((line) => line.trim() === buildIgnoreEntry)) {
    return { kind: "ok", subject: ".gitignore", detail: paths.gitignorePath };
  }
  const next = current === "" || current.endsWith("\n") ? current : `${current}\n`;
  if (!dryRun) {
    writeFileSync(
      paths.gitignorePath,
      `${next}\n# Compiled per-surface skills written by \`skctl apply\`\n${buildIgnoreEntry}\n`,
      "utf-8",
    );
  }
  return {
    kind: current === "" ? "created" : "replaced",
    subject: ".gitignore",
    detail: paths.gitignorePath,
    note: `ignored ${buildIgnoreEntry}`,
  };
};

export const sync = (
  paths: SkillPaths,
  manifest: SkillsManifest = loadManifest(paths.manifestPath),
  dryRun = false,
  activeTags: readonly string[] = [],
): SyncReport => {
  const instructions = syncInstructions(paths, dryRun);
  const { overlays, problems } = loadOverlays(paths);
  const built = new Map<Surface, Set<string>>();
  const skills: Action[] = [...problems, ensureBuildIgnored(paths, dryRun)];

  const localNames = listSkillNames(paths.sourceSkills);
  for (const name of localNames) {
    skills.push(
      ...syncSkill(
        paths,
        resolveEntry(name, manifest.skills[name], manifest, activeTags),
        join(paths.sourceSkills, name),
        dryRun,
        overlays.get(name),
        built,
      ),
    );
  }

  const remotes = resolveRemoteSkills(paths, manifest);
  skills.push(...remotes.problems);
  const localSet = new Set(localNames);
  // Two selected skills can share a directory name across plugins. Both resolve, but a client
  // sees skills by name, so linking both would mean each apply overwrote the other. Report the
  // pair and take neither.
  const byName = new Map<string, typeof remotes.skills>();
  for (const skill of remotes.skills) {
    byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
  }
  for (const skill of remotes.skills) {
    if (localSet.has(skill.name)) {
      skills.push({
        kind: "conflict",
        subject: skill.name,
        detail: `local skill shadows remote '${skill.remote}'`,
      });
      continue;
    }
    const sharing = byName.get(skill.name) ?? [];
    if (sharing.length > 1) {
      if (sharing[0] === skill) {
        skills.push({
          kind: "conflict",
          subject: skill.name,
          detail: `${sharing.length} selected skills are named '${skill.name}'`,
          note: `disable all but one of: ${sharing.map((entry) => entry.path).join(", ")}`,
        });
      }
      continue;
    }
    skills.push(
      ...syncSkill(
        paths,
        resolveEntry(skill.name, manifest.skills[skill.name], manifest, activeTags),
        skill.sourceDir,
        dryRun,
        overlays.get(skill.name),
        built,
      ),
    );
  }

  // Order matters: dropping a stale build first leaves its links dangling, and the broken
  // link sweep then clears them, which covers a skill deleted from source outright.
  skills.push(...pruneBuild(paths.buildDir, built, dryRun));
  for (const surface of AllSurfaces) {
    skills.push(...pruneBrokenLinks(paths.surfaceDirs[surface], dryRun));
  }

  const commandNames = listCommandNames(paths.sourceCommands);
  const commands = commandNames.flatMap((name) =>
    syncCommand(
      paths,
      resolveEntry(name, manifest.commands[name], manifest),
      dryRun,
    ),
  );
  commands.push(...pruneOrphanCommands(paths, new Set(commandNames), dryRun));

  return { dryRun, instructions, skills, commands };
};
