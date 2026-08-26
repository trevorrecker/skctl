import { existsSync, readFileSync } from "node:fs";
import { isRecord } from "../record.js";

export const lockedSkillNames = (path: string): Set<string> => {
  if (!existsSync(path)) return new Set();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!isRecord(parsed) || !isRecord(parsed.skills)) return new Set();
    return new Set(Object.keys(parsed.skills));
  } catch {
    return new Set();
  }
};
