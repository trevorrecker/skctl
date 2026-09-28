export type Host = "claude" | "codex" | "opencode" | "cursor";

export const AllHosts: readonly Host[] = ["claude", "codex", "opencode", "cursor"];

export type CommandHost = "claude" | "codex" | "opencode";

export const CommandHosts: readonly CommandHost[] = ["claude", "codex", "opencode"];

// One output directory each. What a surface accepts, and which hosts read it, lives with the
// provider that owns it in src/providers/.
export type Surface = "claude" | "agents" | "opencode" | "cursor";

export const AllSurfaces: readonly Surface[] = ["claude", "agents", "opencode", "cursor"];

export type Collection = "skills" | "commands";

export interface ManifestEntry {
  enabled?: boolean;
  hosts?: Host[];
  tags?: string[];
  // Managed on purpose despite matching a host built-in, so eject --builtins and doctor
  // leave it alone.
  adopted?: boolean;
}

export interface RemoteEntry {
  url: string;
  skills: string[];
}

export interface SkillsManifest {
  defaultHosts: Host[];
  remotes: Record<string, RemoteEntry>;
  skills: Record<string, ManifestEntry>;
  commands: Record<string, ManifestEntry>;
  // Skills handed back to ~/.agents/skills. Shared rather than machine-local so every
  // machine that pulls the root hands its copy back too, and import never takes it again.
  ejected: string[];
}

export interface ResolvedEntry {
  name: string;
  enabled: boolean;
  hosts: Host[];
  tags: string[];
}

export type ActionKind = "created" | "replaced" | "removed" | "ok" | "conflict";

export interface Action {
  kind: ActionKind;
  detail: string;
  subject?: string;
  note?: string;
}
