import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type { Host } from "./types.js";
import type { SkillPaths } from "./paths.js";

export interface BuiltinOwner {
  host: Host;
  reason: string;
}

const markerKey = (skillDir: string, markerKeys: readonly string[]): string | undefined => {
  if (markerKeys.length === 0) return undefined;
  const skillFile = join(skillDir, "SKILL.md");
  if (!existsSync(skillFile)) return undefined;
  const { data } = parseFrontmatter(readFileSync(skillFile, "utf-8"));
  return markerKeys.find((key) => key in data);
};

// A host's own directory is authoritative. The frontmatter marker only covers copies whose
// name the host no longer lists, so it is checked second and reported as a guess.
export const builtinOwner = (
  paths: SkillPaths,
  name: string,
  skillDir: string,
): BuiltinOwner | undefined => {
  for (const source of paths.builtins) {
    const dir = source.dirs.find((candidate) => existsSync(join(candidate, name, "SKILL.md")));
    if (dir !== undefined) return { host: source.host, reason: `${source.host} built-in` };
  }
  for (const source of paths.builtins) {
    const key = markerKey(skillDir, source.markerKeys);
    if (key !== undefined) {
      return { host: source.host, reason: `looks like a ${source.host} built-in (\`${key}\`)` };
    }
  }
  return undefined;
};
