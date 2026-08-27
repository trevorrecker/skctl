import { guardTokensFor, providerFor, readersOf, surfacesForToken } from "../providers/index.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { applyGuards, guardTokens } from "./guards.js";
import { AllSurfaces } from "./types.js";
import type { Host, Surface } from "./types.js";
import type { Overlay, OverlayRules } from "./overlays.js";

export interface SkillDoc {
  name: string;
  frontmatter: Record<string, unknown>;
  body: string;
  dropped: string[];
}

export interface CompileTarget {
  label: string;
  guardTokens: readonly string[];
  frontmatterKeys: readonly string[];
}

interface CompileContext {
  target: CompileTarget;
  overlay?: Overlay;
  scoped?: OverlayRules;
}

type Step = (doc: SkillDoc, context: CompileContext) => SkillDoc;

// Pasting a skill into a chat box is a target too, even though nothing is written to disk for
// it. Guarding on it is what lets a Claude Code `@path` reference stay out of the prose every
// other reader gets.
export const RaycastTarget: CompileTarget = {
  label: "raycast",
  guardTokens: ["raycast"],
  frontmatterKeys: [],
};

export const surfaceTarget = (surface: Surface): CompileTarget => ({
  label: surface,
  guardTokens: guardTokensFor(surface),
  frontmatterKeys: providerFor(surface).frontmatterKeys,
});

const camelToKebab = new Map([
  ["allowedTools", "allowed-tools"],
  ["disallowedTools", "disallowed-tools"],
  ["disableModelInvocation", "disable-model-invocation"],
  ["userInvocable", "user-invocable"],
]);

// skctl's own bookkeeping, meaningless to every client and rejected by the upload path. These
// leave quietly rather than being reported as dropped.
const internalKeys = new Set(["paste", "tags"]);

const kebab = (key: string): string => camelToKebab.get(key) ?? key;

const rekey = (data: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data).map(([key, value]) => [kebab(key), value]));

const replaceWith = (body: string, rules: OverlayRules | undefined): string =>
  rules === undefined
    ? body
    : rules.replace.reduce(
        (current, [pattern, replacement]) => current.replace(pattern, replacement),
        body,
      );

const mergeWith = (
  data: Record<string, unknown>,
  rules: OverlayRules | undefined,
) => {
  if (rules === undefined) return data;
  const merged = { ...data, ...rekey(rules.set) };
  for (const key of rules.drop) delete merged[kebab(key)];
  return merged;
};

const replaceFromOverlay: Step = (doc, { overlay }) => ({
  ...doc,
  body: replaceWith(doc.body, overlay?.base),
});

const replaceFromSurface: Step = (doc, { scoped }) => ({
  ...doc,
  body: replaceWith(doc.body, scoped),
});

const resolveGuards: Step = (doc, { target }) => ({
  ...doc,
  body: applyGuards(doc.body, target.guardTokens).trim(),
});

const mergeFromOverlay: Step = (doc, { overlay }) => ({
  ...doc,
  frontmatter: mergeWith(doc.frontmatter, overlay?.base),
});

const mergeFromSurface: Step = (doc, { scoped }) => ({
  ...doc,
  frontmatter: mergeWith(doc.frontmatter, scoped),
});

// The directory name is what every client turns into the command, and Cursor wants the two to
// agree, so the compiled file states it rather than trusting whatever the source carried.
const pinName: Step = (doc) => ({
  ...doc,
  frontmatter: { ...doc.frontmatter, name: doc.name },
});

const keepTargetKeys: Step = (doc, { target }) => {
  const frontmatter: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(doc.frontmatter)) {
    if (target.frontmatterKeys.includes(key)) frontmatter[key] = value;
    else if (!internalKeys.has(key)) dropped.push(key);
  }
  return { ...doc, frontmatter, dropped: dropped.sort() };
};

const pipeline: readonly Step[] = [
  replaceFromOverlay,
  replaceFromSurface,
  resolveGuards,
  mergeFromOverlay,
  mergeFromSurface,
  pinName,
  keepTargetKeys,
];

export const compileDoc = (
  name: string,
  source: string,
  target: CompileTarget,
  overlay?: Overlay,
): SkillDoc => {
  const parsed = parseFrontmatter(source);
  const surface = AllSurfaces.find((candidate) => candidate === target.label);
  const context: CompileContext = {
    target,
    overlay,
    scoped: surface === undefined ? undefined : overlay?.surfaces[surface],
  };
  const start: SkillDoc = {
    name,
    frontmatter: rekey(parsed.data),
    body: parsed.content,
    dropped: [],
  };
  return pipeline.reduce<SkillDoc>((doc, step) => step(doc, context), start);
};

export interface CompiledSkill {
  content: string;
  // Kept apart from `content` because frontmatter differing across surfaces is the point of
  // the feature, while a body differing is what could make a client follow the wrong copy.
  body: string;
  dropped: string[];
}

export const compileSkill = (
  name: string,
  source: string,
  surface: Surface,
  overlay?: Overlay,
): CompiledSkill => {
  const doc = compileDoc(name, source, surfaceTarget(surface), overlay);
  return {
    content: stringifyFrontmatter(`\n${doc.body}\n`, doc.frontmatter),
    body: doc.body,
    dropped: doc.dropped,
  };
};

export const compileBody = (
  source: string,
  target: CompileTarget,
  overlay?: Overlay,
): string => compileDoc("", source, target, overlay).body;

export interface SurfacePlan {
  surfaces: Surface[];
  spill: Host[];
}

const subsets = <T>(items: readonly T[]): T[][] =>
  items.reduce<T[][]>((acc, item) => [...acc, ...acc.map((set) => [...set, item])], [[]]);

// No surface reaches Claude Code alone, because OpenCode and Cursor both read ~/.claude/skills
// for compatibility. Coverage therefore has to allow spill, and apply reports it rather than
// pretending `hosts` was honored exactly.
export const planSurfaces = (
  hosts: readonly Host[],
  required: readonly Surface[] = [],
): SurfacePlan => {
  const wanted = new Set(hosts);
  const applicableRequired = required.filter((surface) =>
    providerFor(surface).serves.some((host) => wanted.has(host)),
  );
  const scored = subsets(AllSurfaces)
    .filter(
      (set) => set.length > 0 && applicableRequired.every((surface) => set.includes(surface)),
    )
    .map((set) => {
      const readers = new Set(set.flatMap((surface) => [...readersOf(surface)]));
      return {
        set,
        missing: [...wanted].filter((host) => !readers.has(host)).length,
        spill: [...readers].filter((host) => !wanted.has(host)),
      };
    });
  const best = scored.reduce((left, right) => {
    if (left.missing !== right.missing) return left.missing < right.missing ? left : right;
    if (left.spill.length !== right.spill.length) {
      return left.spill.length < right.spill.length ? left : right;
    }
    return left.set.length <= right.set.length ? left : right;
  });
  return {
    surfaces: AllSurfaces.filter((surface) => best.set.includes(surface)),
    spill: best.spill.sort(),
  };
};

export const variantSurfaces = (source: string, overlay?: Overlay): Surface[] => {
  const required = new Set<Surface>();
  for (const token of guardTokens(parseFrontmatter(source).content)) {
    for (const surface of surfacesForToken(token)) required.add(surface);
  }
  for (const surface of AllSurfaces) {
    if (overlay?.surfaces[surface] !== undefined) required.add(surface);
  }
  return AllSurfaces.filter((surface) => required.has(surface));
};
