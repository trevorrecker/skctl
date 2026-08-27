import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { isRecord } from "../record.js";
import { isValidName } from "./names.js";
import type { Action, SkillsManifest } from "./types.js";
import type { SkillPaths } from "./paths.js";

export interface RemoteGroup {
  path: string;
  name?: string;
  description?: string;
}

export interface RemoteSkill {
  name: string;
  remote: string;
  sourceDir: string;
  path: string;
  group?: RemoteGroup;
}

export interface RemoteCatalogEntry {
  name: string;
  path: string;
  selector: string;
  selected: boolean;
  group?: RemoteGroup;
}

export interface RemoteResolution {
  skills: RemoteSkill[];
  problems: Action[];
}

export interface RemoteInfo {
  alias: string;
  url: string;
  skills: string[];
  available: string[];
  catalog: RemoteCatalogEntry[];
  cloned: boolean;
  head?: string;
}

export interface AddRemoteResult {
  alias: string;
  action: Action;
  manifest: SkillsManifest;
  available: string[];
  selected: string[];
}

export interface ManifestChange {
  action: Action;
  manifest: SkillsManifest;
}

const skippedDirs = new Set(["node_modules", "dist"]);

const findSkillDirs = (root: string): string[] => {
  if (!existsSync(root)) return [];
  const dirs: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    if (existsSync(join(current, "SKILL.md"))) dirs.push(current);
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || skippedDirs.has(entry.name)) continue;
      pending.push(join(current, entry.name));
    }
  }
  return dirs;
};

const pluginManifestDirs = [".cursor-plugin", ".claude-plugin"];

interface CatalogItem {
  name: string;
  path: string;
  group?: RemoteGroup;
}

interface SelectorIndex {
  exact: Map<string, CatalogItem[]>;
  suffix: Map<string, CatalogItem[]>;
}

const normalizeSelector = (selector: string): string =>
  selector
    .trim()
    .split(/[\\/]+/)
    .filter(part => part !== "" && part !== ".")
    .join("/");

export const selectorName = (selector: string): string => {
  const parts = normalizeSelector(selector).split("/");
  return parts[parts.length - 1];
};

const clonePathOf = (clonePath: string, dir: string): string =>
  relative(clonePath, dir).split(sep).join("/");

const firstString = (...values: unknown[]): string | undefined =>
  values
    .find((value): value is string => typeof value === "string" && value.trim() !== "")
    ?.trim();

const readJsonRecord = (file: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const readGroup = (clonePath: string, path: string): RemoteGroup => {
  const group: RemoteGroup = { path };
  for (const manifestDir of pluginManifestDirs) {
    const file = join(clonePath, path, manifestDir, "plugin.json");
    if (!existsSync(file)) continue;
    const record = readJsonRecord(file);
    if (record === undefined) continue;
    const name = firstString(record.displayName, record.name);
    if (name !== undefined) group.name = name;
    const description = firstString(record.description);
    if (description !== undefined) group.description = description;
    return group;
  }
  return group;
};

const groupPath = (path: string): string => {
  const segments = path.split("/").slice(0, -1);
  if (segments[segments.length - 1] === "skills") segments.pop();
  return segments.join("/");
};

const catalogItems = (clonePath: string): CatalogItem[] => {
  const groups = new Map<string, RemoteGroup>();
  return findSkillDirs(clonePath)
    .map(dir => clonePathOf(clonePath, dir))
    .sort()
    .map(path => {
      const dir = groupPath(path);
      if (dir !== "" && !groups.has(dir)) groups.set(dir, readGroup(clonePath, dir));
      return {
        name: path === "" ? basename(clonePath) : path.slice(path.lastIndexOf("/") + 1),
        path,
        group: groups.get(dir),
      };
    });
};

const suffixes = (segments: readonly string[]): string[] =>
  segments.map((_, index) => segments.slice(index).join("/")).reverse();

const selectorKeys = (item: CatalogItem): { exact: string[]; suffix: string[] } => {
  const segments = item.path === "" ? [item.name] : item.path.split("/");
  const group = item.group?.path;
  const compact = group === undefined ? [item.name] : [...group.split("/"), item.name];
  return {
    exact: [...new Set([segments.join("/"), compact.join("/")])],
    suffix: [...new Set([...suffixes(compact), ...suffixes(segments)])],
  };
};

const selectorIndex = (items: readonly CatalogItem[]): SelectorIndex => {
  const index: SelectorIndex = { exact: new Map(), suffix: new Map() };
  const add = (map: Map<string, CatalogItem[]>, key: string, item: CatalogItem): void => {
    map.set(key, [...(map.get(key) ?? []), item]);
  };
  for (const item of items) {
    const keys = selectorKeys(item);
    for (const key of keys.exact) add(index.exact, key, item);
    for (const key of keys.suffix) add(index.suffix, key, item);
  }
  return index;
};

// An exact path wins over a suffix match, so a repository that nests one skill path
// inside another still resolves both.
const matchSelector = (index: SelectorIndex, selector: string): CatalogItem[] =>
  index.exact.get(selector) ?? index.suffix.get(selector) ?? [];

const shortestSelector = (index: SelectorIndex, item: CatalogItem): string =>
  selectorKeys(item).suffix.find(key => matchSelector(index, key).length === 1) ?? item.path;

export const remoteAlias = (url: string): string => {
  const trimmed = url.replace(/[\\/]+$/, "").replace(/\.git$/, "");
  const separator = Math.max(
    trimmed.lastIndexOf("/"),
    trimmed.lastIndexOf("\\"),
    trimmed.lastIndexOf(":"),
  );
  const tail = trimmed.slice(separator + 1);
  return tail.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
};

export const discoverRemoteCatalog = (
  clonePath: string,
  selected: readonly string[] = [],
): RemoteCatalogEntry[] => {
  const items = catalogItems(clonePath);
  const index = selectorIndex(items);
  const selectedAs = new Map<string, string>();
  for (const selector of selected) {
    const matches = matchSelector(index, normalizeSelector(selector));
    if (matches.length !== 1 || selectedAs.has(matches[0].path)) continue;
    selectedAs.set(matches[0].path, selector);
  }
  return items.map(item => ({
    ...item,
    selector: selectedAs.get(item.path) ?? shortestSelector(index, item),
    selected: selectedAs.has(item.path),
  }));
};

export const discoverRemoteSkills = (clonePath: string): string[] =>
  [...new Set(discoverRemoteCatalog(clonePath).map(entry => entry.name))].sort();

export const matchRemoteSelector = (
  catalog: readonly RemoteCatalogEntry[],
  selector: string,
): RemoteCatalogEntry[] => {
  const matched = new Set(
    matchSelector(selectorIndex(catalog), normalizeSelector(selector)).map(item => item.path),
  );
  return catalog.filter(entry => matched.has(entry.path));
};

// A skill entry carries tags and an enabled flag, which are meaningless once nothing supplies
// the skill. Dropping a selection has to take its entry with it, or `skctl status` reports an
// orphan and reselecting the skill silently inherits the old settings. Only what this call
// dropped is considered: an entry for a skill that is merely missing from disk, because its
// remote is not cloned yet, is left for `skctl status` to report rather than deleted.
export const pruneSkillEntries = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  dropped: readonly string[],
): SkillsManifest => {
  const gone = new Set(dropped.map(selectorName));
  const supplied = new Set(
    Object.values(manifest.remotes).flatMap(entry => entry.skills.map(selectorName)),
  );
  return {
    ...manifest,
    skills: Object.fromEntries(
      Object.entries(manifest.skills).filter(
        ([name]) =>
          !gone.has(name) ||
          supplied.has(name) ||
          existsSync(join(paths.sourceSkills, name, "SKILL.md")),
      ),
    ),
  };
};

export const resolveRemoteSkills = (
  paths: SkillPaths,
  manifest: SkillsManifest,
): RemoteResolution => {
  const resolution: RemoteResolution = { skills: [], problems: [] };
  for (const [alias, remote] of Object.entries(manifest.remotes)) {
    if (!isValidName(alias)) {
      resolution.problems.push({
        kind: "conflict",
        subject: alias,
        detail: "remote alias is not a valid name",
      });
      continue;
    }
    const clonePath = join(paths.remotesDir, alias);
    if (!existsSync(clonePath)) {
      resolution.problems.push({
        kind: "conflict",
        subject: alias,
        detail: `remote '${alias}' not cloned`,
        note: "run `skctl pull`",
      });
      continue;
    }
    const items = catalogItems(clonePath);
    const index = selectorIndex(items);
    for (const selector of remote.skills) {
      const matches = matchSelector(index, normalizeSelector(selector));
      if (matches.length === 1) {
        const [item] = matches;
        resolution.skills.push({
          name: item.name,
          remote: alias,
          sourceDir: join(clonePath, item.path),
          path: item.path,
          group: item.group,
        });
        continue;
      }
      resolution.problems.push({
        kind: "conflict",
        subject: selector,
        detail:
          matches.length === 0
            ? `remote '${alias}' has no skill '${selector}'`
            : `remote '${alias}' has ${matches.length} skills matching '${selector}'`,
        note:
          matches.length === 0
            ? undefined
            : `select one of: ${matches.map(item => shortestSelector(index, item)).join(", ")}`,
      });
    }
  }
  return resolution;
};

const git = (args: string[]): string =>
  execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// Discovery needs the working tree but not a catalog's blob history. Not every Git host accepts
// partial-clone filters, so a full clone remains the fallback.
export const cloneRemote = (url: string, clonePath: string): void => {
  try {
    git(["clone", "--filter=blob:none", "--quiet", url, clonePath]);
  } catch {
    rmSync(clonePath, { recursive: true, force: true });
    git(["clone", "--quiet", url, clonePath]);
  }
};

export const updateRoot = (paths: SkillPaths): Action => {
  try {
    const dirty = git(["-C", paths.sourceRepo, "status", "--porcelain"]);
    if (dirty !== "") {
      return {
        kind: "conflict",
        subject: "root",
        detail: "working tree has changes",
      };
    }
    git([
      "-C",
      paths.sourceRepo,
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    const before = git(["-C", paths.sourceRepo, "rev-parse", "HEAD"]);
    git(["-C", paths.sourceRepo, "pull", "--ff-only", "--quiet"]);
    const after = git(["-C", paths.sourceRepo, "rev-parse", "HEAD"]);
    return before === after
      ? { kind: "ok", subject: "root", detail: `up to date (${after.slice(0, 7)})` }
      : {
          kind: "replaced",
          subject: "root",
          detail: `${before.slice(0, 7)} -> ${after.slice(0, 7)}`,
        };
  } catch (error) {
    const message = error instanceof Error ? error.message : `${error}`;
    return { kind: "conflict", subject: "root", detail: "git failed", note: message };
  }
};

export const listRemotes = (
  paths: SkillPaths,
  manifest: SkillsManifest,
): RemoteInfo[] =>
  Object.entries(manifest.remotes).map(([alias, remote]) => {
    if (!isValidName(alias)) {
      return {
        alias,
        url: remote.url,
        skills: remote.skills,
        available: [],
        catalog: [],
        cloned: false,
      };
    }
    const clonePath = join(paths.remotesDir, alias);
    const cloned = existsSync(clonePath);
    let head: string | undefined;
    if (cloned) {
      try {
        head = git(["-C", clonePath, "rev-parse", "--short", "HEAD"]);
      } catch {
        head = undefined;
      }
    }
    const catalog = cloned ? discoverRemoteCatalog(clonePath, remote.skills) : [];
    return {
      alias,
      url: remote.url,
      skills: remote.skills,
      available: catalog.map(entry => entry.selector).sort(),
      catalog,
      cloned,
      head,
    };
  });

export const updateRemotes = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  alias?: string,
): Action[] => {
  const entries = Object.entries(manifest.remotes).filter(
    ([name]) => alias === undefined || name === alias,
  );
  if (alias !== undefined && entries.length === 0) {
    return [{ kind: "conflict", subject: alias, detail: "unknown remote" }];
  }
  return entries.map(([name, remote]) => {
    if (!isValidName(name)) {
      return { kind: "conflict", subject: name, detail: "remote alias is not a valid name" };
    }
    const clonePath = join(paths.remotesDir, name);
    try {
      if (!existsSync(clonePath)) {
        mkdirSync(paths.remotesDir, { recursive: true });
        cloneRemote(remote.url, clonePath);
        return { kind: "created", subject: name, detail: `cloned ${remote.url}` };
      }
      const before = git(["-C", clonePath, "rev-parse", "HEAD"]);
      git(["-C", clonePath, "pull", "--ff-only", "--quiet"]);
      const after = git(["-C", clonePath, "rev-parse", "HEAD"]);
      return before === after
        ? { kind: "ok", subject: name, detail: `up to date (${after.slice(0, 7)})` }
        : {
            kind: "replaced",
            subject: name,
            detail: `${before.slice(0, 7)} -> ${after.slice(0, 7)}`,
          };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "conflict", subject: name, detail: "git failed", note: message };
    }
  });
};

const failedAdd = (
  alias: string,
  manifest: SkillsManifest,
  detail: string,
  note?: string,
): AddRemoteResult => ({
  alias,
  action: { kind: "conflict", subject: alias, detail, note },
  manifest,
  available: [],
  selected: [],
});

export const addRemote = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  url: string,
  options: { alias?: string; skills?: string[]; force?: boolean } = {},
): AddRemoteResult => {
  const alias = options.alias ?? remoteAlias(url);
  if (!isValidName(alias)) {
    return failedAdd(
      alias || url,
      manifest,
      "remote alias is not a valid name",
      "use up to 64 kebab-case characters with single dashes",
    );
  }
  const existing = manifest.remotes[alias];
  if (existing !== undefined && existing.url !== url && options.force !== true) {
    return failedAdd(
      alias,
      manifest,
      `alias already tracks ${existing.url}`,
      "pass a different alias or --force",
    );
  }

  const clonePath = join(paths.remotesDir, alias);
  const existingClone = existsSync(clonePath);
  if (existing === undefined && existingClone && options.force !== true) {
    return failedAdd(
      alias,
      manifest,
      "clone path already exists without a manifest entry",
      "remove it or pass --force",
    );
  }
  const replacingClone =
    existingClone && existing?.url !== url && options.force === true;
  const reusedClone = existingClone && !replacingClone;
  let stagedRoot: string | undefined;
  let catalogPath = clonePath;
  let action: Action;
  try {
    if (replacingClone) {
      mkdirSync(paths.remotesDir, { recursive: true });
      stagedRoot = mkdtempSync(join(paths.remotesDir, `.${alias}-`));
      catalogPath = join(stagedRoot, "clone");
      cloneRemote(url, catalogPath);
      action = { kind: "replaced", subject: alias, detail: `replaced with ${url}` };
    } else if (reusedClone) {
      action = { kind: "ok", subject: alias, detail: "already cloned" };
    } else {
      mkdirSync(paths.remotesDir, { recursive: true });
      cloneRemote(url, clonePath);
      action = { kind: "created", subject: alias, detail: `cloned ${url}` };
    }
  } catch (error) {
    if (stagedRoot !== undefined) rmSync(stagedRoot, { recursive: true, force: true });
    if (!existingClone) rmSync(clonePath, { recursive: true, force: true });
    return failedAdd(
      alias,
      manifest,
      "clone failed",
      error instanceof Error ? error.message : String(error),
    );
  }

  // A clone this call created is worthless without a manifest entry, so any
  // later failure has to take it back down.
  const abandon = (detail: string, note?: string): AddRemoteResult => {
    if (stagedRoot !== undefined) rmSync(stagedRoot, { recursive: true, force: true });
    else if (!reusedClone) rmSync(clonePath, { recursive: true, force: true });
    return failedAdd(alias, manifest, detail, note);
  };

  const catalog = discoverRemoteCatalog(catalogPath);
  if (catalog.length === 0) {
    return abandon("no SKILL.md found in the repository");
  }
  const available = catalog.map(entry => entry.selector).sort();
  const requested = (options.skills ?? []).map(selector => ({
    selector,
    matches: matchRemoteSelector(catalog, selector),
  }));
  const unknown = requested.filter(entry => entry.matches.length === 0);
  if (unknown.length > 0) {
    return abandon(
      `no skill named ${unknown.map(entry => entry.selector).join(", ")}`,
      `available: ${available.join(", ")}`,
    );
  }
  const ambiguous = requested.find(entry => entry.matches.length > 1);
  if (ambiguous !== undefined) {
    return abandon(
      `'${ambiguous.selector}' matches ${ambiguous.matches.length} skills`,
      `select one of: ${ambiguous.matches.map(entry => entry.selector).join(", ")}`,
    );
  }
  const selected = options.skills ?? available;

  if (stagedRoot !== undefined) {
    const previous = join(stagedRoot, "previous");
    try {
      renameSync(clonePath, previous);
      renameSync(catalogPath, clonePath);
      rmSync(stagedRoot, { recursive: true, force: true });
    } catch (error) {
      if (!existsSync(clonePath) && existsSync(previous)) renameSync(previous, clonePath);
      rmSync(stagedRoot, { recursive: true, force: true });
      return failedAdd(
        alias,
        manifest,
        "could not replace the existing clone",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return {
    alias,
    action,
    available,
    selected,
    manifest: {
      ...manifest,
      remotes: { ...manifest.remotes, [alias]: { url, skills: selected } },
    },
  };
};

export const removeRemote = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  alias: string,
  dryRun: boolean,
): ManifestChange => {
  if (!isValidName(alias)) {
    return {
      action: { kind: "conflict", subject: alias, detail: "remote alias is not a valid name" },
      manifest,
    };
  }
  const remote = manifest.remotes[alias];
  if (remote === undefined) {
    return {
      action: { kind: "conflict", subject: alias, detail: "unknown remote" },
      manifest,
    };
  }
  const clonePath = join(paths.remotesDir, alias);
  if (!dryRun && existsSync(clonePath)) {
    rmSync(clonePath, { recursive: true, force: true });
  }
  const remotes = { ...manifest.remotes };
  delete remotes[alias];
  return {
    action: {
      kind: "removed",
      subject: alias,
      detail: clonePath,
      note: `dropped ${remote.skills.length} skill selection(s)`,
    },
    manifest: pruneSkillEntries(paths, { ...manifest, remotes }, remote.skills),
  };
};

export const detachRemoteSkill = (
  paths: SkillPaths,
  manifest: SkillsManifest,
  name: string,
  dryRun: boolean,
): ManifestChange => {
  const suppliers = Object.entries(manifest.remotes)
    .map(([alias, remote]) => ({
      alias,
      selectors: remote.skills.filter(selector => selectorName(selector) === name),
    }))
    .filter(supplier => supplier.selectors.length > 0);
  if (suppliers.length === 0) {
    return {
      action: { kind: "conflict", subject: name, detail: "no active remote skill found" },
      manifest,
    };
  }
  if (suppliers.length > 1 || suppliers[0].selectors.length > 1) {
    return {
      action: {
        kind: "conflict",
        subject: name,
        detail: "more than one selected remote skill has this name",
        note: suppliers.flatMap(supplier => supplier.selectors.map(
          selector => `${supplier.alias}:${selector}`,
        )).join(", "),
      },
      manifest,
    };
  }

  const supplier = suppliers[0];
  const selector = supplier.selectors[0];
  const skill = resolveRemoteSkills(paths, manifest).skills.find(
    remoteSkill => remoteSkill.name === name && remoteSkill.remote === supplier.alias,
  );
  if (skill === undefined) {
    return {
      action: { kind: "conflict", subject: name, detail: "remote skill is not available on disk" },
      manifest,
    };
  }
  const destination = join(paths.sourceSkills, name);
  if (existsSync(destination)) {
    return {
      action: { kind: "conflict", subject: name, detail: "local skill already exists" },
      manifest,
    };
  }

  const remote = manifest.remotes[skill.remote];
  if (remote === undefined) {
    return {
      action: { kind: "conflict", subject: name, detail: `remote '${skill.remote}' is not configured` },
      manifest,
    };
  }
  if (!dryRun) {
    mkdirSync(paths.sourceSkills, { recursive: true });
    cpSync(skill.sourceDir, destination, { recursive: true });
  }

  return {
    action: {
      kind: "created",
      subject: name,
      detail: destination,
      note: `detached from '${skill.remote}'`,
    },
    manifest: {
      ...manifest,
      remotes: {
        ...manifest.remotes,
        [skill.remote]: {
          ...remote,
          skills: remote.skills.filter(candidate => candidate !== selector),
        },
      },
    },
  };
};
