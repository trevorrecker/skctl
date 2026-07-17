import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { defaultManifest, saveManifest } from "./skills/manifest.js";

export interface SkctlConfig {
  root?: string;
  raycastDir?: string;
}

export type RootSource = "flag" | "env" | "config";

export interface ResolvedRoot {
  root: string;
  source: RootSource;
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
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const config: SkctlConfig = {};
    if (typeof parsed.root === "string") config.root = parsed.root;
    if (typeof parsed.raycastDir === "string") config.raycastDir = parsed.raycastDir;
    return config;
  } catch {
    return {};
  }
};

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
): { root: string; created: string[] } => {
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
