import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative } from "node:path";
import {
  ensureSymlink,
  isSymlink,
  pathPresent,
  symlinkTarget,
} from "./fsx.js";
import type { Action } from "./types.js";
import type { SkillPaths } from "./paths.js";

const uniqueLinks = (paths: SkillPaths): string[] => [
  ...new Set(paths.instructionLinks.filter(path => path !== paths.instructionsSource)),
];

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

export const syncInstructions = (
  paths: SkillPaths,
  dryRun: boolean,
): Action[] => {
  if (!existsSync(paths.instructionsSource)) return [];
  const subject = basename(paths.instructionsSource);
  return uniqueLinks(paths).map(path => ({
    ...ensureSymlink(path, paths.instructionsSource, dryRun),
    subject,
  }));
};

export const removeInstructionLink = (
  paths: SkillPaths,
  linkPath: string,
  dryRun: boolean,
): Action => {
  if (!pathPresent(linkPath)) return { kind: "ok", detail: linkPath };
  const expected = relative(dirname(linkPath), paths.instructionsSource);
  if (!isSymlink(linkPath) || symlinkTarget(linkPath) !== expected) {
    return {
      kind: "conflict",
      detail: linkPath,
      note: "is not a managed instruction link, left untouched",
    };
  }
  if (!dryRun) rmSync(linkPath);
  return { kind: "removed", detail: linkPath };
};

export const importInstructions = (
  paths: SkillPaths,
  dryRun: boolean,
) => {
  if (paths.instructionImports.length === 0) {
    throw new Error("global instructions can only be imported in global scope");
  }

  const sourceExists = existsSync(paths.instructionsSource);
  const imports = readImportSources(paths);
  if (!sourceExists && imports.length === 0) {
    throw new Error(`no instructions found at ${paths.instructionImports.join(" or ")}`);
  }
  if (
    !sourceExists &&
    imports.some(source => source.content !== imports[0]?.content)
  ) {
    throw new Error(
      `instruction files have different content: ${imports.map(source => source.path).join(", ")}`,
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
    if (source.content !== content) {
      actions.push({
        kind: "conflict",
        detail: source.path,
        note: "has different content, left untouched",
      });
      continue;
    }
    if (!dryRun) rmSync(source.path);
    actions.push({ kind: "removed", detail: source.path });
  }

  for (const path of uniqueLinks(paths)) {
    actions.push(ensureSymlink(path, paths.instructionsSource, dryRun));
  }
  return { actions, imported: !sourceExists };
};
