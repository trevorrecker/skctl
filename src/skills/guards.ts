const guardPattern = /<!--\s*host:([^\n>]+?)\s*-->([\s\S]*?)<!--\s*\/host\s*-->/g;

const specTokens = (spec: string): { negate: boolean; tokens: string[] } => {
  const negate = spec.startsWith("!");
  return {
    negate,
    tokens: (negate ? spec.slice(1) : spec)
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean),
  };
};

const matchesSpec = (spec: string, targets: readonly string[]): boolean => {
  const { negate, tokens } = specTokens(spec);
  const listed = tokens.some((token) => targets.includes(token));
  return negate ? !listed : listed;
};

export const applyGuards = (body: string, targets: readonly string[]): string =>
  body
    .replace(guardPattern, (_match, spec: string, inner: string) =>
      matchesSpec(spec.trim(), targets) ? inner : "",
    )
    .replace(/\n{3,}/g, "\n\n");

export const guardTokens = (body: string): string[] => {
  const found = new Set<string>();
  for (const match of body.matchAll(guardPattern)) {
    for (const token of specTokens(match[1].trim()).tokens) found.add(token);
  }
  return [...found].sort();
};
