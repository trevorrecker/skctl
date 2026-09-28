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
  // Skills the host ships itself. skctl never imports or serves a copy of one of these.
  builtins?: HostBuiltins;
  docs: string;
}

export interface HostBuiltins {
  host: Host;
  dirs: (home: ProviderHome) => string[];
  // Frontmatter only the host's own skills carry. A copy another tool migrated out of the
  // host's directory keeps these keys even when its name is no longer listed there.
  markerKeys: readonly string[];
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
