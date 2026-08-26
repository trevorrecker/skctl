import { Agents } from "./agents.js";
import { Claude } from "./claude.js";
import { Cursor } from "./cursor.js";
import { OpenCode } from "./opencode.js";
import { AllSurfaces } from "../skills/types.js";
import type { Host, Surface } from "../skills/types.js";
import type { Provider, ProviderHome } from "./types.js";

const registry: Record<Surface, Provider> = {
  claude: Claude,
  agents: Agents,
  opencode: OpenCode,
  cursor: Cursor,
};

export const Providers: readonly Provider[] = AllSurfaces.map(
  (surface) => registry[surface],
);

export const providerFor = (surface: Surface): Provider => registry[surface];

// A guard names a host, but content lands in a surface. Every surface answers to its own
// name plus the hosts it is the canonical home for, which is what routes `host:codex` to
// ~/.agents/skills. Matching stays this narrow on purpose: expanding to every reader would
// put `host:opencode` content into Claude Code's directory.
export const guardTokensFor = (surface: Surface): string[] => [
  ...new Set([surface, ...registry[surface].serves]),
];

export const surfacesForToken = (token: string): Surface[] =>
  AllSurfaces.filter((surface) => guardTokensFor(surface).includes(token));

export const readersOf = (surface: Surface): readonly Host[] => registry[surface].readers;

export const userSkillsDirs = (home: ProviderHome): Record<Surface, string> =>
  ({
    claude: Claude.userSkillsDir(home),
    agents: Agents.userSkillsDir(home),
    opencode: OpenCode.userSkillsDir(home),
    cursor: Cursor.userSkillsDir(home),
  });

export const projectSkillsDirs = (root: string): Record<Surface, string> =>
  ({
    claude: Claude.projectSkillsDir(root),
    agents: Agents.projectSkillsDir(root),
    opencode: OpenCode.projectSkillsDir(root),
    cursor: Cursor.projectSkillsDir(root),
  });
