import {
  cpSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, relative } from "node:path";
import type { Action } from "./types.js";

export const pathPresent = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

export const isSymlink = (path: string): boolean => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

export const symlinkTarget = (path: string): string | undefined => {
  try {
    return readlinkSync(path);
  } catch {
    return undefined;
  }
};

const relativeLink = (linkPath: string, target: string): string =>
  relative(dirname(linkPath), target);

export const ensureSymlink = (
  linkPath: string,
  target: string,
  dryRun: boolean,
): Action => {
  const desired = relativeLink(linkPath, target);
  if (isSymlink(linkPath)) {
    if (symlinkTarget(linkPath) === desired) {
      return { kind: "ok", detail: linkPath };
    }
    if (!dryRun) {
      rmSync(linkPath);
      symlinkSync(desired, linkPath);
    }
    return { kind: "replaced", detail: `${linkPath} -> ${desired}` };
  }
  if (pathPresent(linkPath)) {
    return { kind: "conflict", detail: `${linkPath} exists and is not a symlink` };
  }
  if (!dryRun) {
    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(desired, linkPath);
  }
  return { kind: "created", detail: `${linkPath} -> ${desired}` };
};

export const removeIfSymlink = (linkPath: string, dryRun: boolean): Action => {
  if (!pathPresent(linkPath)) return { kind: "ok", detail: linkPath };
  if (!isSymlink(linkPath)) {
    return { kind: "conflict", detail: `${linkPath} is a real path, left untouched` };
  }
  if (!dryRun) rmSync(linkPath);
  return { kind: "removed", detail: linkPath };
};

export const moveDir = (from: string, to: string): void => {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true });
};
