import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { builtinOwner } from "./builtins.js";
import { writeStandaloneSkill } from "./build.js";
import { pathPresent } from "./fsx.js";
import { removeSkillEntry, setEjected } from "./manifest.js";
import { loadOverlays } from "./overlays.js";
import { resolveRemoteSkills } from "./remotes.js";
import { listSkillNames, ownsAgentsEntry } from "./sync.js";
import type { Action, SkillsManifest } from "./types.js";
import type { SkillPaths } from "./paths.js";

export interface EjectResult {
  actions: Action[];
  manifest: SkillsManifest;
}

const refuse = (
  manifest: SkillsManifest,
  name: string,
  detail: string,
  note?: string,
): EjectResult => ({ actions: [{ kind: "conflict", subject: name, detail, note }], manifest });

// Ejecting hands a skill to whoever owns it once skctl stops: the host that ships it, or
// ~/.agents/skills for anything else. Only the second is recorded, because built-in
// detection already keeps import away from the first.
export const ejectSkill = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  name: string,
  dryRun: boolean,
): EjectResult => {
  const sourceDir = join(paths.sourceSkills, name);
  if (!existsSync(join(sourceDir, "SKILL.md"))) {
    const remote = resolveRemoteSkills(paths, manifest).skills.find((skill) => skill.name === name);
    if (remote !== undefined) {
      return refuse(manifest, name, `comes from remote '${remote.remote}'`, "disable it, or detach it first");
    }
    return refuse(
      manifest,
      name,
      manifest.ejected.includes(name) ? "already ejected" : "no local skill with this name",
    );
  }

  const actions: Action[] = [];
  const owner = builtinOwner(paths, name, sourceDir);
  if (owner === undefined) {
    const dest = join(paths.surfaceDirs.agents, name);
    const present = pathPresent(dest);
    if (present && !ownsAgentsEntry(paths, dest)) {
      return refuse(manifest, name, `${dest} already exists`, "move it aside, then eject again");
    }
    let skipped: string[] = [];
    if (!dryRun) {
      if (present) rmSync(dest);
      skipped = writeStandaloneSkill(
        name,
        sourceDir,
        "agents",
        loadOverlays(paths).overlays.get(name),
        dest,
      );
    }
    actions.push({
      kind: present ? "replaced" : "created",
      subject: name,
      detail: dest,
      note: skipped.length === 0
        ? "ejected"
        : `ejected without ${skipped.join(", ")}, which point outside the skill`,
    });
  }

  const overlayPath = join(paths.overlaysDir, `${name}.md`);
  if (existsSync(overlayPath)) {
    if (!dryRun) rmSync(overlayPath);
    actions.push({ kind: "removed", subject: name, detail: overlayPath, note: "overlay" });
  }
  if (!dryRun) rmSync(sourceDir, { recursive: true, force: true });
  actions.push({
    kind: "removed",
    subject: name,
    detail: sourceDir,
    note: owner === undefined
      ? "ejected to ~/.agents/skills"
      : `${owner.reason}, ejected to ${owner.host}`,
  });
  return {
    actions,
    manifest: owner === undefined ? setEjected(manifest, name) : removeSkillEntry(manifest, name),
  };
};

export const ejectSkills = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  names: readonly string[],
  dryRun: boolean,
): EjectResult =>
  names.reduce<EjectResult>(
    (result, name) => {
      const next = ejectSkill(paths, result.manifest, name, dryRun);
      return { actions: [...result.actions, ...next.actions], manifest: next.manifest };
    },
    { actions: [], manifest },
  );

export const builtinShadows = (paths: SkillPaths, manifest: SkillsManifest): string[] =>
  listSkillNames(paths.sourceSkills).filter(
    (name) =>
      manifest.skills[name]?.adopted !== true &&
      builtinOwner(paths, name, join(paths.sourceSkills, name)) !== undefined,
  );
