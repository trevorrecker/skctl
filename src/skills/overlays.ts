import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import { AllSurfaces } from "./types.js";
import { isRecord } from "../record.js";
import type { Action, Surface } from "./types.js";
import type { SkillPaths } from "./paths.js";

export interface OverlayRules {
  replace: Array<[RegExp, string]>;
  set: Record<string, unknown>;
  drop: string[];
}

export interface Overlay {
  name: string;
  path: string;
  base: OverlayRules;
  surfaces: Partial<Record<Surface, OverlayRules>>;
}

export interface OverlayLoad {
  overlays: Map<string, Overlay>;
  problems: Action[];
}

const emptyRules = (): OverlayRules => ({ replace: [], set: {}, drop: [] });

const asPairs = (value: unknown): Array<[string, string]> => {
  if (Array.isArray(value)) {
    return value.flatMap((entry): Array<[string, string]> => {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") return [];
      return [[entry[0], typeof entry[1] === "string" ? entry[1] : ""]];
    });
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([pattern, replacement]) => [
    pattern,
    typeof replacement === "string" ? replacement : "",
  ]);
};

const parseRules = (
  value: Record<string, unknown>,
  label: string,
  problems: Action[],
): OverlayRules => {
  const rules = emptyRules();
  for (const [pattern, replacement] of asPairs(value.replace)) {
    try {
      rules.replace.push([new RegExp(pattern, "gm"), replacement]);
    } catch (error) {
      problems.push({
        kind: "conflict",
        subject: label,
        detail: `invalid replace pattern '${pattern}'`,
        note: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (isRecord(value.set)) rules.set = { ...value.set };
  if (Array.isArray(value.drop)) {
    rules.drop = value.drop.filter((key): key is string => typeof key === "string");
  }
  return rules;
};

export const parseOverlay = (
  name: string,
  path: string,
  source: string,
  problems: Action[],
): Overlay => {
  const { data } = parseFrontmatter(source);
  const overlay: Overlay = {
    name,
    path,
    base: parseRules(data, name, problems),
    surfaces: {},
  };
  for (const surface of AllSurfaces) {
    const scoped = data[surface];
    if (isRecord(scoped)) {
      overlay.surfaces[surface] = parseRules(scoped, `${name} (${surface})`, problems);
    }
  }
  return overlay;
};

export const loadOverlays = (paths: SkillPaths): OverlayLoad => {
  const load: OverlayLoad = { overlays: new Map(), problems: [] };
  if (!existsSync(paths.overlaysDir)) return load;
  for (const file of readdirSync(paths.overlaysDir).sort()) {
    if (!file.endsWith(".md")) continue;
    const path = join(paths.overlaysDir, file);
    const name = file.slice(0, -3);
    try {
      load.overlays.set(
        name,
        parseOverlay(name, path, readFileSync(path, "utf-8"), load.problems),
      );
    } catch (error) {
      load.problems.push({
        kind: "conflict",
        subject: name,
        detail: path,
        note: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return load;
};

export const overlayTouchesSurface = (overlay: Overlay, surface: Surface): boolean => {
  const rules = overlay.surfaces[surface];
  return rules !== undefined && (
    rules.replace.length > 0 ||
    Object.keys(rules.set).length > 0 ||
    rules.drop.length > 0
  );
};
