import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { AllHosts } from "./types.js";
import type {
  Collection,
  Host,
  ManifestEntry,
  RemoteEntry,
  ResolvedEntry,
  SkillsManifest,
} from "./types.js";

const isHost = (value: unknown): value is Host =>
  typeof value === "string" && (AllHosts as readonly string[]).includes(value);

const parseHosts = (value: unknown): Host[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const hosts = value.filter(isHost);
  return hosts.length > 0 ? hosts : undefined;
};

const normalizeEntry = (value: unknown): ManifestEntry => {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  const entry: ManifestEntry = {};
  if (typeof record.enabled === "boolean") entry.enabled = record.enabled;
  const hosts = parseHosts(record.hosts);
  if (hosts) entry.hosts = hosts;
  return entry;
};

const normalizeEntries = (value: unknown): Record<string, ManifestEntry> => {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, ManifestEntry> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = normalizeEntry(raw);
  }
  return out;
};

const normalizeRemotes = (value: unknown): Record<string, RemoteEntry> => {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, RemoteEntry> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.url !== "string") continue;
    const skills = Array.isArray(record.skills)
      ? record.skills.filter((name): name is string => typeof name === "string")
      : [];
    out[key] = { url: record.url, skills };
  }
  return out;
};

export const defaultManifest = (): SkillsManifest => ({
  defaultHosts: [...AllHosts],
  remotes: {},
  skills: {},
  commands: {},
});

export const loadManifest = (manifestPath: string): SkillsManifest => {
  if (!existsSync(manifestPath)) return defaultManifest();
  const parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as
    | Partial<SkillsManifest>
    | undefined;
  return {
    defaultHosts: parseHosts(parsed?.defaultHosts) ?? [...AllHosts],
    remotes: normalizeRemotes(parsed?.remotes),
    skills: normalizeEntries(parsed?.skills),
    commands: normalizeEntries(parsed?.commands),
  };
};

export const saveManifest = (
  manifestPath: string,
  manifest: SkillsManifest,
): void => {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
};

export const resolveEntry = (
  name: string,
  entry: ManifestEntry | undefined,
  manifest: SkillsManifest,
): ResolvedEntry => ({
  name,
  enabled: entry?.enabled ?? true,
  hosts: entry?.hosts ?? manifest.defaultHosts,
});

export const setEnabled = (
  manifest: SkillsManifest,
  collection: Collection,
  name: string,
  enabled: boolean,
): SkillsManifest => {
  const current = manifest[collection][name] ?? {};
  return {
    ...manifest,
    [collection]: {
      ...manifest[collection],
      [name]: { ...current, enabled },
    },
  };
};
