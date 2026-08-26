import type { Host, Surface } from "../skills/types.js";

export interface ProviderHome {
  home: string;
  claudeConfigDir: string;
  codexHome: string;
  opencodeConfigDir: string;
  cursorConfigDir: string;
}

export interface Provider {
  // The output directory this provider owns, and the name a `<!-- host:... -->` guard uses
  // to target it.
  surface: Surface;
  title: string;
  // Hosts for which this directory is the canonical home.
  serves: readonly Host[];
  // Every host that reads this directory, including the ones that only read it for
  // cross-tool compatibility. `readers` minus `serves` is the spill apply reports.
  readers: readonly Host[];
  // Frontmatter this provider accepts. Anything else is dropped during compilation.
  frontmatterKeys: readonly string[];
  userSkillsDir: (home: ProviderHome) => string;
  projectSkillsDir: (root: string) => string;
  docs: string;
}

// The portable Agent Skills baseline shared by providers that implement the specification.
export const AgentSkillsSpecKeys = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
];
