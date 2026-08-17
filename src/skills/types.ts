export const AllHosts = ["claude", "codex", "opencode"] as const;

export type Host = (typeof AllHosts)[number];

export type Collection = "skills" | "commands";

export interface ManifestEntry {
  enabled?: boolean;
  hosts?: Host[];
  tags?: string[];
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
