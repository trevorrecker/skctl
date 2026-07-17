import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { compileCommand, isGeneratedCommand } from "./commands.js";
import { ensureSymlink, removeIfSymlink, symlinkTarget } from "./fsx.js";
import { loadManifest, resolveEntry } from "./manifest.js";
import { resolveRemoteSkills } from "./remotes.js";
import type { Action, ResolvedEntry, SkillsManifest } from "./types.js";
import type { SkillPaths } from "./paths.js";

export interface SyncReport {
  dryRun: boolean;
  skills: Action[];
  commands: Action[];
}

const tag = (name: string, action: Action): Action => ({
  kind: action.kind,
  detail: `${name}: ${action.detail}`,
});

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

const syncSkill = (
  paths: SkillPaths,
  resolved: ResolvedEntry,
  dryRun: boolean,
  sourceDir?: string,
): Action[] => {
  const { name } = resolved;
  const source = sourceDir ?? join(paths.sourceSkills, name);
  const agentsLink = join(paths.agentsSkills, name);
  const claudeLink = join(paths.claudeSkills, name);
  // In project scope the source already lives in the agents dir, so there is no
  // registry hop to create; the Claude link points straight at the source.
  const linksAgents = paths.agentsSkills !== paths.sourceSkills;
  const claudeTarget = linksAgents ? agentsLink : source;

  if (!resolved.enabled) {
    const actions = [tag(name, removeIfSymlink(claudeLink, dryRun))];
    if (linksAgents) actions.push(tag(name, removeIfSymlink(agentsLink, dryRun)));
    return actions;
  }

  const actions: Action[] = [];
  if (linksAgents) actions.push(tag(name, ensureSymlink(agentsLink, source, dryRun)));
  actions.push(
    resolved.hosts.includes("claude")
      ? tag(name, ensureSymlink(claudeLink, claudeTarget, dryRun))
      : tag(name, removeIfSymlink(claudeLink, dryRun)),
  );
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
      return { kind: "conflict", detail: `${dest} exists and was not generated` };
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
    return { kind: "conflict", detail: `${dest} was not generated, left untouched` };
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
      actions.push({ kind: "removed", detail: `${full} (orphaned)` });
    }
  }
  return actions;
};

const pruneStaleRemoteLinks = (
  dir: string,
  remotesDir: string,
  active: Set<string>,
  dryRun: boolean,
): Action[] => {
  if (!existsSync(dir)) return [];
  const actions: Action[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isSymbolicLink() || active.has(entry.name)) continue;
    const path = join(dir, entry.name);
    const target = symlinkTarget(path);
    if (target === undefined) continue;
    if (!resolve(dirname(path), target).startsWith(remotesDir + sep)) continue;
    if (!dryRun) rmSync(path);
    actions.push({ kind: "removed", detail: `${path} (remote skill unmasked)` });
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
      actions.push({ kind: "removed", detail: `${path} (broken link)` });
    }
  }
  return actions;
};

export const sync = (
  paths: SkillPaths,
  manifest: SkillsManifest = loadManifest(paths.manifestPath),
  dryRun = false,
): SyncReport => {
  const localNames = listSkillNames(paths.sourceSkills);
  const skills = localNames.flatMap((name) =>
    syncSkill(paths, resolveEntry(name, manifest.skills[name], manifest), dryRun),
  );

  const remotes = resolveRemoteSkills(paths, manifest);
  skills.push(...remotes.problems);
  const localSet = new Set(localNames);
  const activeRemote = new Set<string>();
  for (const skill of remotes.skills) {
    if (localSet.has(skill.name)) {
      skills.push({
        kind: "conflict",
        detail: `${skill.name}: local skill shadows remote '${skill.remote}'`,
      });
      continue;
    }
    activeRemote.add(skill.name);
    skills.push(
      ...syncSkill(
        paths,
        resolveEntry(skill.name, manifest.skills[skill.name], manifest),
        dryRun,
        skill.sourceDir,
      ),
    );
  }
  skills.push(
    ...pruneStaleRemoteLinks(paths.agentsSkills, paths.remotesDir, activeRemote, dryRun),
    ...pruneStaleRemoteLinks(paths.claudeSkills, paths.remotesDir, activeRemote, dryRun),
  );
  skills.push(...pruneBrokenLinks(paths.agentsSkills, dryRun));
  skills.push(...pruneBrokenLinks(paths.claudeSkills, dryRun));

  const commandNames = listCommandNames(paths.sourceCommands);
  const commands = commandNames.flatMap((name) =>
    syncCommand(
      paths,
      resolveEntry(name, manifest.commands[name], manifest),
      dryRun,
    ),
  );
  commands.push(...pruneOrphanCommands(paths, new Set(commandNames), dryRun));

  return { dryRun, skills, commands };
};
