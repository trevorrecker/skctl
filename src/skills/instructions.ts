import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import { applyGuards } from "./guards.js";
import { guardTokensFor } from "../providers/index.js";
import { surfaceForInstructionFile } from "./paths.js";
import { pathPresent } from "./fsx.js";
import type { Action, Surface } from "./types.js";
import type { InstructionTarget, SkillPaths } from "./paths.js";

// The whole instruction file is the body: resolve its host guards for the target's surface,
// exactly as a skill body is compiled, so `<!-- host:claude -->` lands only in Claude's file.
export const compileInstruction = (source: string, surface: Surface): string => {
  const resolved = applyGuards(source, guardTokensFor(surface));
  return resolved.endsWith("\n") ? resolved : `${resolved}\n`;
};

export const hashInstruction = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const readImportSources = (
  paths: SkillPaths,
): Array<{ path: string; content: string }> =>
  paths.instructionImports.flatMap(path => {
    if (!pathPresent(path)) return [];
    if (!existsSync(path) || lstatSync(path).isDirectory()) {
      throw new Error(`cannot import instructions from ${path}`);
    }
    return [{ path, content: readFileSync(path, "utf-8") }];
  });

// Instruction files are prompt text a model reads, so skctl cannot stamp an ownership marker
// into them the way it does for commands. It tracks the hash of what it last wrote instead:
// a target that no longer matches that hash was edited by hand and is left untouched.
const writeInstruction = (
  target: InstructionTarget,
  source: string,
  recordedHash: string | undefined,
  dryRun: boolean,
): { action: Action; hash?: string } => {
  const content = compileInstruction(source, target.surface);
  const dest = target.path;
  if (!existsSync(dest)) {
    if (!dryRun) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, content, "utf-8");
    }
    return { action: { kind: "created", detail: dest }, hash: hashInstruction(content) };
  }
  const current = readFileSync(dest, "utf-8");
  if (current === content) {
    return { action: { kind: "ok", detail: dest }, hash: hashInstruction(content) };
  }
  if (recordedHash === undefined || hashInstruction(current) !== recordedHash) {
    return {
      action: { kind: "conflict", detail: dest, note: "edited by hand, left untouched" },
    };
  }
  if (!dryRun) writeFileSync(dest, content, "utf-8");
  return { action: { kind: "replaced", detail: dest }, hash: hashInstruction(content) };
};

export const syncInstructions = (
  paths: SkillPaths,
  dryRun: boolean,
  hashes: Record<string, string> = {},
): { actions: Action[]; hashes: Record<string, string> } => {
  if (!existsSync(paths.instructionsSource)) return { actions: [], hashes };
  const source = readFileSync(paths.instructionsSource, "utf-8");
  const subject = basename(paths.instructionsSource);
  const actions: Action[] = [];
  const next: Record<string, string> = { ...hashes };
  for (const target of paths.instructionLinks) {
    const { action, hash } = writeInstruction(
      target,
      source,
      hashes[target.path],
      dryRun,
    );
    actions.push({ ...action, subject });
    if (!dryRun && hash !== undefined) next[target.path] = hash;
  }
  return { actions, hashes: dryRun ? hashes : next };
};

export const removeInstructionLink = (
  target: string,
  recordedHash: string | undefined,
  dryRun: boolean,
): Action => {
  if (!existsSync(target)) return { kind: "ok", detail: target };
  const current = readFileSync(target, "utf-8");
  if (recordedHash === undefined || hashInstruction(current) !== recordedHash) {
    return { kind: "conflict", detail: target, note: "edited by hand, left untouched" };
  }
  if (!dryRun) rmSync(target);
  return { kind: "removed", detail: target };
};

export const importInstructions = (
  paths: SkillPaths,
  dryRun: boolean,
): { actions: Action[]; imported: boolean } => {
  if (paths.instructionImports.length === 0) {
    throw new Error("global instructions can only be imported in global scope");
  }

  const sourceExists = existsSync(paths.instructionsSource);
  const imports = readImportSources(paths);
  if (!sourceExists && imports.length === 0) {
    throw new Error(`no instructions found at ${paths.instructionImports.join(" or ")}`);
  }
  // A merge that cannot round-trip is worse than none, so import never invents host guards.
  // Divergent home files are reported; the user reconciles them or writes guards by hand.
  if (
    !sourceExists &&
    imports.some(source => source.content !== imports[0]?.content)
  ) {
    throw new Error(
      `home instruction files differ (${imports.map(source => source.path).join(", ")}); ` +
        "reconcile them or add host guards to the source, then import",
    );
  }

  const content = sourceExists
    ? readFileSync(paths.instructionsSource, "utf-8")
    : imports[0]?.content ?? "";
  const actions: Action[] = [];
  if (!sourceExists) {
    if (!dryRun) {
      mkdirSync(dirname(paths.instructionsSource), { recursive: true });
      writeFileSync(paths.instructionsSource, content, "utf-8");
    }
    actions.push({ kind: "created", detail: paths.instructionsSource });
  }

  for (const source of imports) {
    const expected = compileInstruction(content, surfaceForInstructionFile(source.path));
    if (source.content !== expected) {
      actions.push({
        kind: "conflict",
        detail: source.path,
        note: "differs from the tracked source, left untouched",
      });
      continue;
    }
    if (!dryRun) rmSync(source.path);
    actions.push({ kind: "removed", detail: source.path });
  }
  return { actions, imported: !sourceExists };
};
