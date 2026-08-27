import { AllHosts, AllSurfaces } from "./types.js";

const guardPattern = /<!--\s*host:([^\n>]+?)\s*-->([\s\S]*?)<!--\s*\/host\s*-->/g;
const markerPattern = /<!--\s*(?:host:([^\n>]*?)|\/host)\s*-->/g;
const incompleteMarkerPattern = /<!--\s*(?:host:|\/host\b)/;
const knownTokens = new Set([...AllHosts, ...AllSurfaces, "raycast"]);

const specTokens = (spec: string): { negate: boolean; tokens: string[] } => {
  const negate = spec.startsWith("!");
  const tokens = (negate ? spec.slice(1) : spec)
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) throw new Error("host guard needs at least one target");
  const unknown = tokens.find((token) => !knownTokens.has(token));
  if (unknown !== undefined) throw new Error(`unknown host guard target '${unknown}'`);
  return { negate, tokens };
};

const validateGuards = (body: string): void => {
  let open = false;
  for (const match of body.matchAll(markerPattern)) {
    const spec = match[1];
    if (spec === undefined) {
      if (!open) throw new Error("host guard closes without an opening marker");
      open = false;
      continue;
    }
    if (open) throw new Error("host guards cannot be nested");
    specTokens(spec.trim());
    open = true;
  }
  if (open) throw new Error("host guard is missing a closing marker");
  if (incompleteMarkerPattern.test(body.replace(markerPattern, ""))) {
    throw new Error("host guard marker is malformed");
  }
};

const matchesSpec = (spec: string, targets: readonly string[]): boolean => {
  const { negate, tokens } = specTokens(spec);
  const listed = tokens.some((token) => targets.includes(token));
  return negate ? !listed : listed;
};

export const applyGuards = (body: string, targets: readonly string[]): string => {
  validateGuards(body);
  return body
    .replace(guardPattern, (_match, spec: string, inner: string) =>
      matchesSpec(spec.trim(), targets) ? inner : "",
    )
    .replace(/\n{3,}/g, "\n\n");
};

export const guardTokens = (body: string): string[] => {
  validateGuards(body);
  const found = new Set<string>();
  for (const match of body.matchAll(guardPattern)) {
    for (const token of specTokens(match[1].trim()).tokens) found.add(token);
  }
  return [...found].sort();
};
