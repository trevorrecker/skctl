import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defaultManifest, saveManifest } from "./skills/manifest.js";

export interface SkctlConfig {
  root?: string;
  raycastDir?: string;
  activeTags?: string[];
  instructionTargets?: string[];
  remoteRefreshHours?: number;
  remoteRefreshes?: Record<string, string>;
}

export type RootSource = "flag" | "env" | "config";

export interface ResolvedRoot {
  root: string;
  source: RootSource;
}

export interface InitializedRoot {
  root: string;
  created: string[];
}

export const configPath = (home: string = homedir()): string =>
  join(
    process.env.XDG_CONFIG_HOME ?? join(home, ".config"),
    "skctl",
    "config.json",
  );

export const loadConfig = (path: string = configPath()): SkctlConfig => {
  if (!existsSync(path)) return {};
  try {
    // SAFETY: the assertion only permits property reads, and every field below is
    // typeof-checked before use. A non-object parse result throws on first read and
    // lands in the catch, which returns an empty config.
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const config: SkctlConfig = {};
    if (typeof parsed.root === "string") config.root = parsed.root;
    if (typeof parsed.raycastDir === "string") config.raycastDir = parsed.raycastDir;
    if (Array.isArray(parsed.activeTags)) {
      config.activeTags = parsed.activeTags.filter(
        (tag): tag is string => typeof tag === "string",
      );
    }
    if (Array.isArray(parsed.instructionTargets)) {
      config.instructionTargets = [
        ...new Set(
          parsed.instructionTargets.filter(
            (target): target is string => typeof target === "string",
          ),
        ),
      ].sort();
    }
    if (
      typeof parsed.remoteRefreshHours === "number" &&
      Number.isFinite(parsed.remoteRefreshHours) &&
      parsed.remoteRefreshHours > 0
    ) {
      config.remoteRefreshHours = parsed.remoteRefreshHours;
    }
    if (typeof parsed.remoteRefreshes === "object" && parsed.remoteRefreshes !== null) {
      config.remoteRefreshes = Object.fromEntries(
        Object.entries(parsed.remoteRefreshes).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
    return config;
  } catch {
    return {};
  }
};

export const setTagActive = (
  config: SkctlConfig,
  tag: string,
  active: boolean,
): SkctlConfig => {
  const tags = new Set(config.activeTags ?? []);
  if (active) tags.add(tag);
  else tags.delete(tag);
  return { ...config, activeTags: [...tags].sort() };
};

export const setInstructionTarget = (
  config: SkctlConfig,
  target: string,
  enabled: boolean,
): SkctlConfig => {
  const targets = new Set(config.instructionTargets ?? []);
  if (enabled) targets.add(target);
  else targets.delete(target);
  return { ...config, instructionTargets: [...targets].sort() };
};

export const remoteRefreshDue = (
  config: SkctlConfig,
  root: string,
  now: Date = new Date(),
): boolean => {
  if (config.remoteRefreshHours === undefined) return false;
  const last = config.remoteRefreshes?.[root];
  if (last === undefined) return true;
  const elapsed = now.getTime() - new Date(last).getTime();
  return !Number.isFinite(elapsed) || elapsed >= config.remoteRefreshHours * 60 * 60 * 1000;
};

export const markRemoteRefreshed = (
  config: SkctlConfig,
  root: string,
  now: Date = new Date(),
): SkctlConfig => ({
  ...config,
  remoteRefreshes: {
    ...config.remoteRefreshes,
    [root]: now.toISOString(),
  },
});

export const saveConfig = (
  config: SkctlConfig,
  path: string = configPath(),
): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
};

export const resolveRoot = (
  opts: { flagRoot?: string; configFile?: string } = {},
): ResolvedRoot => {
  if (opts.flagRoot) return { root: resolve(opts.flagRoot), source: "flag" };
  const env = process.env.SKCTL_ROOT;
  if (env) return { root: resolve(env), source: "env" };
  const config = loadConfig(opts.configFile);
  if (config.root) return { root: resolve(config.root), source: "config" };
  throw new Error(
    "no skills root configured — run `skctl init <dir>` or set SKCTL_ROOT",
  );
};

export const initRoot = (
  dir: string,
  configFile: string = configPath(),
): InitializedRoot => {
  const root = resolve(dir);
  const created: string[] = [];
  for (const sub of ["skills", "commands", "remotes"]) {
    const path = join(root, sub);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
      created.push(`${sub}/`);
    }
  }
  const manifestPath = join(root, "skills.config.json");
  if (!existsSync(manifestPath)) {
    saveManifest(manifestPath, defaultManifest());
    created.push("skills.config.json");
  }
  const config = loadConfig(configFile);
  config.root = root;
  saveConfig(config, configFile);
  return { root, created };
};
