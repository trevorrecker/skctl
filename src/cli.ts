#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  commandContent,
  listCommands,
  listSkills,
  skillContent,
} from "./skills/inspect.js";
import { doctor } from "./skills/doctor.js";
import { importLooseSkills } from "./skills/import.js";
import {
  importInstructions,
  removeInstructionLink,
  syncInstructions,
} from "./skills/instructions.js";
import { createCommand, createSkill } from "./skills/create.js";
import { validateName } from "./skills/names.js";
import {
  loadManifest,
  saveManifest,
  setEnabled,
  setHosts,
  setTags,
} from "./skills/manifest.js";
import {
  resolveProjectPaths,
  resolveProjectTarget,
  resolveSkillPaths,
} from "./skills/paths.js";
import {
  loadProjectConfig,
  reconcileProject,
  removeProject,
  saveProjectConfig,
  selectForProject,
} from "./skills/project.js";
import {
  addRemote,
  detachRemoteSkill,
  listRemotes,
  removeRemote,
  updateRemotes,
  updateRoot,
} from "./skills/remotes.js";
import { isSymlink, pathPresent } from "./skills/fsx.js";
import { sync } from "./skills/sync.js";
import { AllHosts } from "./skills/types.js";
import type { CommandInfo, SkillInfo } from "./skills/inspect.js";
import type { ProjectTarget, SkillPaths } from "./skills/paths.js";
import type { ProjectConfig, ProjectMode, ProjectReport } from "./skills/project.js";
import type { Action, Collection, Host } from "./skills/types.js";
import {
  configPath,
  initRoot,
  loadConfig,
  markRemoteRefreshed,
  remoteRefreshDue,
  resolveRoot,
  saveConfig,
  setInstructionHashes,
  setInstructionTarget,
  setTagActive,
} from "./config.js";
import { browse } from "./browse.js";
import { defaultRaycastDir, syncRaycast } from "./raycast.js";
import {
  getScheduleStatus,
  installSchedule,
  removeSchedule,
} from "./schedule.js";
import {
  applyData,
  conflictCount,
  remoteCatalogLines,
  renderApply,
  renderCommands,
  renderDetails,
  renderError,
  renderNotice,
  renderRemoteAdded,
  renderRemotes,
  renderSkills,
  renderStatus,
  renderTags,
  renderUsage,
  statusData,
} from "./render.js";
import type { ApplyResult, ReportSection, TagInfo } from "./render.js";
import { Marks, dim, setColor, shortPath } from "./ui.js";
import type { DetailPair } from "./ui.js";

interface Args {
  positional: string[];
  help: boolean;
  version: boolean;
  root?: string;
  project?: string | true;
  output?: string;
  dir?: string;
  description?: string;
  body?: string;
  argumentHint?: string;
  hosts?: string;
  tags?: string;
  skills?: string;
  color?: boolean;
  dryRun: boolean;
  quiet: boolean;
  paste: boolean;
  noPaste: boolean;
  noRaycast: boolean;
  projectMode?: ProjectMode;
  apply: boolean;
  force: boolean;
}

interface CommandOutput {
  text: string;
  data?: unknown;
  conflicts?: number;
}

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    positional: [],
    help: false,
    version: false,
    dryRun: false,
    quiet: false,
    paste: false,
    noPaste: false,
    noRaycast: false,
    apply: false,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = (inline?: string): string => {
      if (inline !== undefined) {
        if (inline === "") throw new Error(`${token} requires a value`);
        return inline;
      }
      const next = argv[index + 1];
      if (next === undefined || (next.startsWith("-") && next !== "-")) {
        throw new Error(`${token} requires a value`);
      }
      index += 1;
      return next;
    };
    if (token === "--dry-run") args.dryRun = true;
    else if (token === "-h" || token === "--help") args.help = true;
    else if (token === "-v" || token === "--version") args.version = true;
    else if (token === "-q" || token === "--quiet") args.quiet = true;
    else if (token === "--color") args.color = true;
    else if (token === "--no-color") args.color = false;
    else if (token === "--paste") args.paste = true;
    else if (token === "--no-paste") args.noPaste = true;
    else if (token === "--no-raycast") args.noRaycast = true;
    else if (token === "--copy") args.projectMode = "copy";
    else if (token === "--link") args.projectMode = "link";
    else if (token === "--apply") args.apply = true;
    else if (token === "--force") args.force = true;
    else if (token === "--project") args.project = true;
    else if (token.startsWith("--project=")) args.project = value(token.slice("--project=".length));
    else if (token === "--root") args.root = value();
    else if (token.startsWith("--root=")) args.root = value(token.slice("--root=".length));
    else if (token === "--dir") args.dir = value();
    else if (token.startsWith("--dir=")) args.dir = value(token.slice("--dir=".length));
    else if (token === "-d" || token === "--description") args.description = value();
    else if (token.startsWith("-d=")) args.description = value(token.slice("-d=".length));
    else if (token.startsWith("--description=")) args.description = value(token.slice("--description=".length));
    else if (token === "--body") args.body = value();
    else if (token.startsWith("--body=")) args.body = value(token.slice("--body=".length));
    else if (token === "--argument-hint" || token === "--arg-hint") args.argumentHint = value();
    else if (token.startsWith("--argument-hint=")) args.argumentHint = value(token.slice("--argument-hint=".length));
    else if (token === "--hosts") args.hosts = value();
    else if (token.startsWith("--hosts=")) args.hosts = value(token.slice("--hosts=".length));
    else if (token === "--tags") args.tags = value();
    else if (token.startsWith("--tags=")) args.tags = value(token.slice("--tags=".length));
    else if (token === "--skills") args.skills = value();
    else if (token.startsWith("--skills=")) args.skills = value(token.slice("--skills=".length));
    else if (token === "-o" || token === "--output") args.output = value();
    else if (token.startsWith("-o=")) args.output = value(token.slice("-o=".length));
    else if (token.startsWith("--output=")) args.output = value(token.slice("--output=".length));
    else if (token.startsWith("-")) throw new Error(`unknown option: ${token}`);
    else args.positional.push(token);
  }
  return args;
};

const resolveScope = (
  args: Args,
  config = loadConfig(),
): SkillPaths => {
  if (args.project !== undefined) {
    const dir = typeof args.project === "string" ? args.project : process.cwd();
    return resolveProjectPaths(dir);
  }
  const { root } = resolveRoot({ flagRoot: args.root });
  return resolveSkillPaths(
    homedir(),
    root,
    undefined,
    undefined,
    undefined,
    config.instructionTargets,
  );
};

type Resource = "skills" | "commands" | "remotes" | "tags";

const resolveResource = (token: string | undefined): Resource | undefined => {
  switch (token) {
    case "skills":
    case "skill":
      return "skills";
    case "commands":
    case "command":
    case "cmd":
      return "commands";
    case "remotes":
    case "remote":
      return "remotes";
    case "tags":
    case "tag":
      return "tags";
    default:
      return undefined;
  }
};

type OutFmt = "wide" | "name" | "json" | "body" | "raw";
const OutputFormats: readonly OutFmt[] = ["wide", "name", "json", "body", "raw"];

const parseOutput = (output: string | undefined): OutFmt => {
  const value = output ?? "wide";
  const format = OutputFormats.find((candidate) => candidate === value);
  if (format !== undefined) return format;
  throw new Error(`unknown output format '${output}' (use ${OutputFormats.join("|")})`);
};

const parseHours = (value: string): number => {
  const match = /^(\d+(?:\.\d+)?)h?$/.exec(value);
  const hours = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("interval must be a positive number of hours, such as 24h");
  }
  return hours;
};

const notice = (lines: string[], data?: unknown): CommandOutput => ({
  text: renderNotice(lines),
  data,
});

const requireList = (fmt: OutFmt): void => {
  if (fmt === "body" || fmt === "raw") {
    throw new Error("-o body|raw requires a single <name>");
  }
};

const scopeLabel = (paths: SkillPaths): string =>
  paths.scope === "project"
    ? `${shortPath(paths.sourceRepo)} (project)`
    : shortPath(paths.sourceRepo);

const skillsList = (paths: SkillPaths, args: Args): CommandOutput => {
  const fmt = parseOutput(args.output);
  requireList(fmt);
  const skills = listSkills(paths, args.paste, loadConfig().activeTags);
  if (fmt === "name") return { text: skills.map((skill) => skill.name).join("\n"), data: skills };
  return {
    text: renderSkills(skills, scopeLabel(paths)),
    data: skills,
  };
};

const commandsList = (paths: SkillPaths, args: Args): CommandOutput => {
  const fmt = parseOutput(args.output);
  requireList(fmt);
  const commands = listCommands(paths);
  if (fmt === "name") {
    return { text: commands.map((command) => command.name).join("\n"), data: commands };
  }
  return {
    text: renderCommands(commands, scopeLabel(paths)),
    data: commands,
  };
};

const remotesList = (paths: SkillPaths, args: Args): CommandOutput => {
  const fmt = parseOutput(args.output);
  requireList(fmt);
  const remotes = listRemotes(paths, loadManifest(paths.manifestPath));
  if (fmt === "name") {
    return { text: remotes.map((remote) => remote.alias).join("\n"), data: remotes };
  }
  return { text: renderRemotes(remotes), data: remotes };
};

const tagRows = (paths: SkillPaths): TagInfo[] => {
  const manifest = loadManifest(paths.manifestPath);
  const active = new Set(loadConfig().activeTags ?? []);
  const counts = new Map<string, number>();
  for (const entry of Object.values(manifest.skills)) {
    for (const tag of entry.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  for (const tag of active) if (!counts.has(tag)) counts.set(tag, 0);
  return [...counts.entries()]
    .map(([name, skills]) => ({ name, active: active.has(name), skills }))
    .sort((left, right) => left.name.localeCompare(right.name));
};

const findTag = (paths: SkillPaths, name: string): TagInfo => {
  const tag = tagRows(paths).find((item) => item.name === name);
  if (tag === undefined) throw new Error(`unknown tag: ${name}`);
  return tag;
};

const tagsList = (paths: SkillPaths, args: Args, name?: string): CommandOutput => {
  const fmt = parseOutput(args.output);
  if (fmt === "body" || fmt === "raw") throw new Error("-o body|raw not valid for tags");
  if (name !== undefined) {
    const tag = findTag(paths, name);
    if (fmt === "name") return { text: tag.name, data: tag };
    return { text: renderTags([tag]), data: tag };
  }
  const tags = tagRows(paths);
  if (fmt === "name") return { text: tags.map((tag) => tag.name).join("\n"), data: tags };
  return { text: renderTags(tags), data: tags };
};

const findSkill = (paths: SkillPaths, name: string): SkillInfo => {
  const info = listSkills(paths, false, loadConfig().activeTags).find(
    (skill) => skill.name === name,
  );
  if (!info) throw new Error(`unknown skill: ${name}`);
  return info;
};

const findCommand = (paths: SkillPaths, name: string): CommandInfo => {
  const info = listCommands(paths).find((command) => command.name === name);
  if (!info) throw new Error(`unknown command: ${name}`);
  return info;
};

const yesNo = (value: boolean): string => (value ? "yes" : "no");

const describeSkill = (info: SkillInfo): string =>
  renderDetails(
    "skill",
    info.name,
    [
      ["availability", info.availability],
      ["hosts", info.hosts.join(", ")],
      [
        "surfaces",
        info.spill.length > 0
          ? `${info.surfaces.join(", ")}  ${dim(`also read by ${info.spill.join(", ")}`)}`
          : info.surfaces.join(", "),
      ],
      ["tags", info.tags.length > 0 ? info.tags.join(", ") : dim(Marks.none)],
      ...(info.remote === undefined ? [] : [["remote", info.remote] satisfies DetailPair]),
      ...(info.overlay === undefined
        ? []
        : [["overlay", shortPath(info.overlay)] satisfies DetailPair]),
      ["path", shortPath(info.path)],
    ],
    info.description || dim("(no description)"),
  );

const describeCommand = (info: CommandInfo): string =>
  renderDetails(
    "command",
    info.name,
    [
      ["enabled", yesNo(info.enabled)],
      ["hosts", info.hosts.join(", ")],
      ["path", shortPath(info.path)],
    ],
    info.description || dim("(no description)"),
  );

const getSkill = (paths: SkillPaths, name: string, fmt: OutFmt): CommandOutput => {
  const info = findSkill(paths, name);
  if (fmt === "body") return { text: skillContent(paths, name, false), data: info };
  if (fmt === "raw") return { text: skillContent(paths, name, true), data: info };
  if (fmt === "name") return { text: info.name, data: info };
  return { text: describeSkill(info), data: info };
};

const getCommand = (paths: SkillPaths, name: string, fmt: OutFmt): CommandOutput => {
  const info = findCommand(paths, name);
  if (fmt === "body") return { text: commandContent(paths, name, false), data: info };
  if (fmt === "raw") return { text: commandContent(paths, name, true), data: info };
  if (fmt === "name") return { text: info.name, data: info };
  return { text: describeCommand(info), data: info };
};

const getRemote = (paths: SkillPaths, name: string, fmt: OutFmt): CommandOutput => {
  const info = listRemotes(paths, loadManifest(paths.manifestPath)).find(
    (remote) => remote.alias === name,
  );
  if (!info) throw new Error(`unknown remote: ${name}`);
  if (fmt === "body" || fmt === "raw") throw new Error("-o body|raw not valid for remotes");
  if (fmt === "name") return { text: info.alias, data: info };
  const state = info.cloned ? (info.head ? `cloned@${info.head}` : "cloned") : "not cloned";
  return {
    text: renderDetails("remote", info.alias, [
      ["url", info.url],
      ["state", state],
      ["selected", `${info.skills.length} of ${info.cloned ? info.catalog.length : "?"}`],
      ["skills", remoteCatalogLines(info)],
    ]),
    data: info,
  };
};

const describeDispatch = (args: Args): CommandOutput => {
  const resource = resolveResource(args.positional[1]);
  const name = args.positional[2];
  if (!resource || !name) {
    throw new Error("usage: skctl describe skill|command|remote|tag <name>");
  }
  const paths = resolveScope(args);
  if (resource === "remotes") return getRemote(paths, name, "wide");
  if (resource === "tags") {
    const tag = findTag(paths, name);
    return {
      text: renderDetails("tag", tag.name, [
        ["active", yesNo(tag.active)],
        ["skills", String(tag.skills)],
      ]),
      data: tag,
    };
  }
  if (resource === "commands") {
    const info = findCommand(paths, name);
    return { text: describeCommand(info), data: info };
  }
  const info = findSkill(paths, name);
  return { text: describeSkill(info), data: info };
};

const raycastTarget = (args: Args): string =>
  args.dir ?? loadConfig().raycastDir ?? defaultRaycastDir();

const raycastEnabled = (args: Args): boolean =>
  !args.noRaycast && (loadConfig().raycastEnabled ?? process.platform === "darwin");

const scheduledRemoteRefresh = (
  paths: SkillPaths,
  dryRun: boolean,
): Action[] => {
  const config = loadConfig();
  const manifest = loadManifest(paths.manifestPath);
  if (
    config.remoteRefreshHours === undefined ||
    Object.keys(manifest.remotes).length === 0 ||
    (!remoteRefreshDue(config, paths.sourceRepo) &&
      listRemotes(paths, manifest).every(remote => remote.cloned))
  ) {
    return [];
  }
  if (dryRun) {
    return [{ kind: "ok", detail: "scheduled remote refresh is due" }];
  }
  const actions = updateRemotes(paths, manifest);
  if (actions.every(action => action.kind !== "conflict")) {
    saveConfig(markRemoteRefreshed(config, paths.sourceRepo));
  }
  return actions;
};

const sameHashes = (
  a: Record<string, string> = {},
  b: Record<string, string> = {},
): boolean => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

const applyResult = (
  paths: SkillPaths,
  args: Args,
  opts: {
    verb?: string;
    dryRun: boolean;
    refreshRemotes?: boolean;
    leading?: ReportSection[];
  },
): ApplyResult => {
  const refreshed = opts.refreshRemotes === false
    ? []
    : scheduledRemoteRefresh(paths, opts.dryRun);
  const config = loadConfig();
  const report = sync(
    paths,
    loadManifest(paths.manifestPath),
    opts.dryRun,
    config.activeTags,
    config.instructionHashes,
  );
  if (!opts.dryRun && !sameHashes(config.instructionHashes, report.instructionHashes)) {
    saveConfig(setInstructionHashes(loadConfig(), report.instructionHashes));
  }
  const sections: ReportSection[] = [...(opts.leading ?? [])];
  if (refreshed.length > 0) {
    sections.push({ name: "remotes", note: "scheduled refresh", actions: refreshed });
  }
  if (report.instructions.length > 0) {
    sections.push({ name: "instructions", actions: report.instructions });
  }
  sections.push(
    { name: "skills", actions: report.skills },
    { name: "commands", actions: report.commands },
  );
  // Raycast is a machine-local convenience rather than part of the manifest, so apply
  // keeps its scripts current without adding a row to every report. Only a script
  // someone hand-edited is worth interrupting for.
  if (!opts.dryRun && raycastEnabled(args) && paths.scope === "global") {
    const conflicts = syncRaycast(paths, raycastTarget(args), config.activeTags).filter(
      (action) => action.kind === "conflict",
    );
    if (conflicts.length > 0) sections.push({ name: "raycast", actions: conflicts });
  }
  return {
    verb: opts.verb ?? "apply",
    dryRun: opts.dryRun,
    root: paths.sourceRepo,
    hosts: [...AllHosts],
    sections,
  };
};

const applyOutput = (
  result: ApplyResult,
  args: Args,
  notices: string[] = [],
): CommandOutput => ({
  text: renderApply(result, { quiet: args.quiet, notices }),
  data: applyData(result, notices),
  conflicts: conflictCount(result),
});

const applyDispatch = (args: Args): CommandOutput => {
  const paths = resolveScope(args);
  return applyOutput(applyResult(paths, args, { dryRun: args.dryRun }), args);
};

const looksLikeUrl = (value: string): boolean => /[:/\\]/.test(value);

const resolvePullTarget = (
  manifest: ReturnType<typeof loadManifest>,
  target: string,
): string => {
  if (manifest.remotes[target] !== undefined) return target;
  const tracked = Object.entries(manifest.remotes).find(([, remote]) => remote.url === target);
  if (tracked) return tracked[0];
  if (looksLikeUrl(target)) {
    throw new Error(
      `no remote tracks ${target}\nrun \`skctl remote add ${target}\` to start tracking it`,
    );
  }
  return target;
};

const pullDispatch = (args: Args): CommandOutput => {
  const paths = resolveScope(args);
  const manifest = loadManifest(paths.manifestPath);
  const target = args.positional[1];
  const alias = target === undefined ? undefined : resolvePullTarget(manifest, target);
  if (Object.keys(manifest.remotes).length === 0) {
    return notice([
      "no remotes configured",
      dim("add one with `skctl remote add <url>`"),
    ]);
  }
  const actions = updateRemotes(paths, manifest, alias);
  if (alias === undefined && actions.every(action => action.kind !== "conflict")) {
    saveConfig(markRemoteRefreshed(loadConfig(), paths.sourceRepo));
  }
  return applyOutput(
    applyResult(paths, args, {
      verb: "pull",
      dryRun: false,
      refreshRemotes: false,
      leading: [{ name: "remotes", actions }],
    }),
    args,
  );
};

const refreshDispatch = (args: Args): CommandOutput => {
  const paths = resolveScope(args);
  if (paths.scope !== "global") {
    throw new Error("refresh requires a global skills root");
  }
  const rootAction = updateRoot(paths);
  const manifest = loadManifest(paths.manifestPath);
  const remoteActions = updateRemotes(paths, manifest);
  if (remoteActions.every(action => action.kind !== "conflict")) {
    saveConfig(markRemoteRefreshed(loadConfig(), paths.sourceRepo));
  }
  return applyOutput(
    applyResult(paths, args, {
      verb: "refresh",
      dryRun: false,
      refreshRemotes: false,
      leading: [
        { name: "root", actions: [rootAction] },
        { name: "remotes", actions: remoteActions },
      ],
    }),
    args,
  );
};

const toggleDispatch = (args: Args, enabled: boolean): CommandOutput => {
  const resource = resolveResource(args.positional[1]);
  const name = args.positional[2];
  const verb = enabled ? "enable" : "disable";
  if (resource === "tags") {
    if (!name) throw new Error(`usage: skctl ${verb} tag <name>`);
    validateName(name);
    const paths = resolveScope(args);
    saveConfig(setTagActive(loadConfig(), name, enabled));
    return applyOutput(applyResult(paths, args, { dryRun: false }), args, [
      `${enabled ? "activated" : "deactivated"} tag '${name}'`,
    ]);
  }
  if (resource !== "skills" && resource !== "commands") {
    throw new Error(`usage: skctl ${verb} skill|command|tag <name>`);
  }
  if (!name) throw new Error(`usage: skctl ${verb} skill|command <name>`);
  const paths = resolveScope(args);
  const collection: Collection = resource;
  if (collection === "skills") findSkill(paths, name);
  else findCommand(paths, name);
  saveManifest(
    paths.manifestPath,
    setEnabled(loadManifest(paths.manifestPath), collection, name, enabled),
  );
  return applyOutput(applyResult(paths, args, { dryRun: false }), args, [
    `${enabled ? "enabled" : "disabled"} ${collection.slice(0, -1)} '${name}'`,
  ]);
};

const importDispatch = (args: Args): CommandOutput => {
  const paths = resolveScope(args);
  const resource = args.positional[1] ?? "skills";
  if (resource === "instructions") {
    const report = importInstructions(paths, args.dryRun);
    const actions = [...report.actions];
    if (!args.dryRun) {
      const config = loadConfig();
      const synced = syncInstructions(paths, false, config.instructionHashes);
      actions.push(...synced.actions);
      if (!sameHashes(config.instructionHashes, synced.hashes)) {
        saveConfig(setInstructionHashes(loadConfig(), synced.hashes));
      }
    }
    return applyOutput(
      {
        verb: args.dryRun ? "import instructions" : "import",
        dryRun: args.dryRun,
        root: paths.sourceRepo,
        hosts: paths.commandHosts,
        sections: [{ name: "instructions", actions }],
      },
      args,
      [`${report.imported ? "imported" : "reconciled"} instructions`],
    );
  }
  if (resource !== "skills" && resource !== "skill") {
    throw new Error("usage: skctl import [skills|instructions] [--dry-run]");
  }
  const report = importLooseSkills(paths, args.dryRun);
  const lead = `imported ${report.imported.length} skill(s)${
    report.imported.length > 0 ? `: ${report.imported.join(", ")}` : ""
  }`;
  if (args.dryRun || report.imported.length === 0) {
    return {
      text: renderNotice([
        lead,
        ...report.skipped.map((action) => dim(`skipped  ${action.detail}`)),
      ]),
      data: report,
      conflicts: 0,
    };
  }
  return applyOutput(applyResult(paths, args, { dryRun: false }), args, [
    lead,
    ...report.skipped.map((action) => dim(`skipped  ${action.detail}`)),
  ]);
};

const instructionTargetPath = (value: string): string =>
  value === "~"
    ? homedir()
    : value.startsWith("~/")
      ? resolve(homedir(), value.slice(2))
      : resolve(value);

const instructionDispatch = (args: Args): CommandOutput => {
  if (args.project !== undefined) {
    throw new Error("instruction targets are machine-local and require global scope");
  }
  const operation = args.positional[1] ?? "list";
  const config = loadConfig();
  const paths = resolveScope(args, config);
  const clientPaths = resolveScope(args, { ...config, instructionTargets: [] });
  if (operation === "list") {
    const clientTargets = new Set(clientPaths.instructionLinks.map((entry) => entry.path));
    const targets = paths.instructionLinks.map((target) => ({
      target: target.path,
      origin: clientTargets.has(target.path) ? "client" : "local",
    }));
    return {
      text: renderDetails(
        "instructions",
        shortPath(paths.instructionsSource),
        targets.map(
          (entry) => [entry.origin, shortPath(entry.target)] satisfies DetailPair,
        ),
      ),
      data: { source: paths.instructionsSource, targets },
    };
  }
  const value = args.positional[2];
  if (value === undefined || (operation !== "add" && operation !== "remove")) {
    throw new Error("usage: skctl instruction list|add|remove [path]");
  }
  const target = instructionTargetPath(value);
  if (paths.instructionImports.includes(target)) {
    throw new Error(`${target} is a home import path and can duplicate hierarchy instructions`);
  }
  if (target === paths.instructionsSource) {
    throw new Error("the instruction source cannot be its own target");
  }
  if (operation === "add") {
    if (clientPaths.instructionLinks.some((entry) => entry.path === target)) {
      throw new Error(`instruction target is already managed for this client: ${target}`);
    }
    const nextConfig = setInstructionTarget(config, target, true);
    saveConfig(nextConfig);
    return applyOutput(
      applyResult(resolveScope(args, nextConfig), args, { dryRun: false }),
      args,
      [`added instruction target: ${shortPath(target)}`],
    );
  }
  if (!(config.instructionTargets ?? []).includes(target)) {
    throw new Error(`instruction target is not configured: ${target}`);
  }
  const action = clientPaths.instructionLinks.some((entry) => entry.path === target)
    ? { kind: "ok", detail: target } satisfies Action
    : removeInstructionLink(target, config.instructionHashes?.[target], false);
  const remainingHashes = { ...config.instructionHashes };
  delete remainingHashes[target];
  saveConfig(setInstructionHashes(setInstructionTarget(config, target, false), remainingHashes));
  return applyOutput(
    {
      verb: "instruction remove",
      dryRun: false,
      root: paths.sourceRepo,
      hosts: paths.commandHosts,
      sections: [{ name: "instructions", actions: [action] }],
    },
    args,
    [`removed instruction target: ${shortPath(target)}`],
  );
};

const detachDispatch = (args: Args): CommandOutput => {
  const paths = resolveScope(args);
  if (args.positional[1] !== "skill" || args.positional[2] === undefined) {
    throw new Error("usage: skctl detach skill <name> [--dry-run]");
  }
  const manifest = loadManifest(paths.manifestPath);
  const result = detachRemoteSkill(
    paths,
    manifest,
    args.positional[2],
    args.dryRun,
  );
  const detached = result.action.kind !== "conflict";
  if (!args.dryRun && detached) {
    saveManifest(paths.manifestPath, result.manifest);
  }
  if (args.dryRun || !detached) {
    return applyOutput(
      {
        verb: "detach",
        dryRun: args.dryRun,
        root: paths.sourceRepo,
        hosts: [...AllHosts],
        sections: [{ name: "detach", actions: [result.action] }],
      },
      args,
    );
  }
  return applyOutput(
    applyResult(paths, args, {
      verb: "detach",
      dryRun: false,
      leading: [{ name: "detach", actions: [result.action] }],
    }),
    args,
  );
};

const tagDispatch = (args: Args, remove: boolean): CommandOutput => {
  const name = args.positional[2];
  const tags = args.positional.slice(3);
  if (args.positional[1] !== "skill" || name === undefined || tags.length === 0) {
    throw new Error(`usage: skctl ${remove ? "untag" : "tag"} skill <name> <tag...>`);
  }
  tags.forEach(validateName);
  const paths = resolveScope(args);
  if (!listSkills(paths).some(skill => skill.name === name)) {
    throw new Error(`unknown skill: ${name}`);
  }
  const manifest = loadManifest(paths.manifestPath);
  const current = manifest.skills[name]?.tags ?? [];
  const next = remove
    ? current.filter(tag => !tags.includes(tag))
    : [...current, ...tags];
  saveManifest(paths.manifestPath, setTags(manifest, name, next));
  return notice(
    [
      `${remove ? "removed" : "added"} ${tags.join(", ")} ${remove ? "from" : "to"} '${name}'`,
      dim(`tags: ${next.join(", ") || Marks.none}`),
    ],
    { skill: name, tags: next },
  );
};

const statusDispatch = (args: Args): CommandOutput => {
  const paths = resolveScope(args);
  const report = doctor(paths, loadConfig().instructionHashes);
  return {
    text: renderStatus(report, paths.sourceRepo, { quiet: args.quiet }),
    data: statusData(report, paths.sourceRepo),
    conflicts: report.issues.length,
  };
};

const initDispatch = (args: Args): CommandOutput => {
  const { root, created } = initRoot(args.positional[1] ?? process.cwd());
  return notice(
    [
      `registered root: ${shortPath(root)}`,
      dim(created.length > 0 ? `created: ${created.join(", ")}` : "already scaffolded"),
    ],
    { root, created },
  );
};

const configDispatch = (args: Args): CommandOutput => {
  if (args.positional[1] === "set") {
    const key = args.positional[2];
    const value = args.positional[3];
    if (
      !value ||
      (key !== "root" &&
        key !== "raycast" &&
        key !== "raycastDir" &&
        key !== "refresh")
    ) {
      throw new Error("usage: skctl config set root|raycast|refresh <value>");
    }
    const config = loadConfig();
    if (key === "root") config.root = resolve(value);
    else if (key === "raycast" || key === "raycastDir") {
      if (value === "off" || value === "on") config.raycastEnabled = value === "on";
      else {
        config.raycastDir = resolve(value);
        delete config.raycastEnabled;
      }
    } else if (value === "off") {
      delete config.remoteRefreshHours;
    } else {
      config.remoteRefreshHours = parseHours(value);
    }
    saveConfig(config);
    const setting =
      key === "refresh"
        ? config.remoteRefreshHours === undefined
          ? "off"
          : `${config.remoteRefreshHours}h`
        : value === "off" || value === "on"
          ? value
          : shortPath(resolve(value));
    return notice([`set ${key === "raycastDir" ? "raycast" : key} = ${setting}`], config);
  }
  const config = loadConfig();
  let root: string;
  try {
    const resolved = resolveRoot({ flagRoot: args.root });
    root = `${shortPath(resolved.root)} ${dim(`(${resolved.source})`)}`;
  } catch {
    root = dim("unset; run `skctl init <dir>` or set SKCTL_ROOT");
  }
  return {
    text: renderDetails("config", shortPath(configPath()), [
      ["root", root],
      [
        "raycast",
        `${(config.raycastEnabled ?? process.platform === "darwin") ? "on" : "off"}  ${dim(
          config.raycastDir === undefined
            ? `${shortPath(defaultRaycastDir())} (default)`
            : shortPath(config.raycastDir),
        )}`,
      ],
      ["active tags", config.activeTags ?? []],
      ["instruction targets", (config.instructionTargets ?? []).map(shortPath)],
      [
        "remote refresh",
        config.remoteRefreshHours === undefined ? "off" : `${config.remoteRefreshHours}h`,
      ],
    ]),
    data: config,
  };
};

const scheduleEnvironment = () =>
  Object.fromEntries([
    ["HOME", homedir()],
    ...[
      "CLAUDE_CONFIG_DIR",
      "CODEX_HOME",
      "CURSOR_CONFIG_DIR",
      "OPENCODE_CONFIG_DIR",
      "SKCTL_ROOT",
      "XDG_CONFIG_HOME",
    ].flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value]];
    }),
  ]);

const scheduleDispatch = (args: Args): CommandOutput => {
  if (args.project !== undefined) {
    throw new Error("refresh schedules require global scope");
  }
  const operation = args.positional[1] ?? "status";
  const config = loadConfig();
  const logPath = join(dirname(configPath()), "refresh.log");
  if (operation === "install") {
    const intervalHours = args.positional[2] === undefined
      ? config.remoteRefreshHours ?? 24
      : parseHours(args.positional[2]);
    const paths = resolveScope(args, config);
    const status = installSchedule({
      nodePath: process.execPath,
      cliPath: fileURLToPath(import.meta.url),
      root: paths.sourceRepo,
      logPath,
      intervalHours,
      environment: scheduleEnvironment(),
    });
    config.remoteRefreshHours = intervalHours;
    saveConfig(config);
    return notice(
      [
        `installed refresh schedule: every ${intervalHours}h`,
        dim(`path: ${shortPath(status.path)}`),
        dim(`loaded: ${yesNo(status.loaded)}`),
      ],
      { ...status, intervalHours },
    );
  }
  if (operation === "remove") {
    const status = removeSchedule();
    return notice(
      ["removed refresh schedule", dim(`path: ${shortPath(status.path)}`)],
      status,
    );
  }
  if (operation !== "status") {
    throw new Error("usage: skctl schedule install [hours]|status|remove");
  }
  const status = getScheduleStatus();
  return {
    text: renderDetails("schedule", "refresh", [
      ["installed", yesNo(status.installed)],
      ["loaded", yesNo(status.loaded)],
      [
        "interval",
        config.remoteRefreshHours === undefined ? dim("unset") : `${config.remoteRefreshHours}h`,
      ],
      ["path", shortPath(status.path)],
      ["log", shortPath(logPath)],
    ]),
    data: { ...status, intervalHours: config.remoteRefreshHours, logPath },
  };
};

const getDispatch = (args: Args): CommandOutput => {
  const resource = resolveResource(args.positional[1]);
  if (!resource) throw new Error("usage: skctl get skills|commands|remotes|tags [name]");
  const name = args.positional[2];
  const paths = resolveScope(args);
  const fmt = parseOutput(args.output);
  if (resource === "skills") return name ? getSkill(paths, name, fmt) : skillsList(paths, args);
  if (resource === "commands") {
    return name ? getCommand(paths, name, fmt) : commandsList(paths, args);
  }
  if (resource === "remotes") return name ? getRemote(paths, name, fmt) : remotesList(paths, args);
  return tagsList(paths, args, name);
};

const prompt = async (question: string): Promise<string> => {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf-8");
};

const isHost = (value: string): value is Host =>
  AllHosts.some((host) => host === value);

const parseHostList = (value: string | undefined): Host[] | undefined => {
  if (value === undefined) return undefined;
  const tokens = value.split(",").map((host) => host.trim()).filter(Boolean);
  const invalid = tokens.filter((token) => !isHost(token));
  if (invalid.length > 0) {
    throw new Error(`unknown host(s): ${invalid.join(", ")} (valid: ${AllHosts.join(", ")})`);
  }
  return tokens.filter(isHost);
};

const createDispatch = async (args: Args): Promise<CommandOutput> => {
  const resource = resolveResource(args.positional[1]);
  if (resource !== "skills" && resource !== "commands") {
    throw new Error("usage: skctl create skill|command [name] [-d desc] [--body text] ...");
  }
  const paths = resolveScope(args);
  const interactive = process.stdin.isTTY === true;
  const body = args.body === "-" ? await readStdin() : args.body;
  const hosts = parseHostList(args.hosts);
  const tags = args.tags?.split(",").map(tag => tag.trim()).filter(Boolean);
  tags?.forEach(validateName);

  let name = args.positional[2];
  if (!name && interactive) name = (await prompt("name: ")).trim();
  if (!name) throw new Error("create requires a <name>; pass it as an argument or run in a terminal");
  validateName(name);

  let description = args.description;
  if (description === undefined && interactive) {
    const answer = (await prompt("description (blank for a TODO): ")).trim();
    if (answer) description = answer;
  }

  const collection: Collection = resource;
  const dest =
    resource === "skills"
      ? createSkill(paths, { name, description, paste: !args.noPaste, body }, args.force)
      : createCommand(paths, { name, description, argumentHint: args.argumentHint, body }, args.force);

  const lines = [`created ${collection.slice(0, -1)} '${name}'`, dim(shortPath(dest))];
  if (hosts) {
    saveManifest(paths.manifestPath, setHosts(loadManifest(paths.manifestPath), collection, name, hosts));
    lines.push(dim(`hosts: ${hosts.join(", ")}`));
  }
  if (resource === "skills" && tags !== undefined) {
    saveManifest(paths.manifestPath, setTags(loadManifest(paths.manifestPath), name, tags));
    lines.push(dim(`tags: ${tags.join(", ") || Marks.none}`));
  }
  if (args.apply) {
    return applyOutput(applyResult(paths, args, { dryRun: false }), args, lines);
  }
  const projectFlag = paths.scope === "project" ? " --project" : "";
  return notice([...lines, dim(`run \`skctl apply${projectFlag}\` to materialize it into hosts`)], {
    name,
    path: dest,
    hosts,
    tags,
  });
};

const remoteAddDispatch = (args: Args, paths: SkillPaths): CommandOutput => {
  const url = args.positional[2];
  if (url === undefined) {
    throw new Error("usage: skctl remote add <url> [alias] [--skills a,b]");
  }
  const alias = args.positional[3];
  if (alias !== undefined) validateName(alias);
  const skills = args.skills?.split(",").map(name => name.trim()).filter(Boolean);
  const result = addRemote(paths, loadManifest(paths.manifestPath), url, {
    alias,
    skills,
    force: args.force,
  });
  if (result.action.kind === "conflict") {
    return applyOutput(
      {
        verb: "remote add",
        dryRun: false,
        root: paths.sourceRepo,
        hosts: [...AllHosts],
        sections: [{ name: "remotes", actions: [result.action] }],
      },
      args,
    );
  }
  saveManifest(paths.manifestPath, result.manifest);
  return applyOutput(
    applyResult(paths, args, {
      verb: "remote add",
      dryRun: false,
      refreshRemotes: false,
      leading: [{ name: "remotes", actions: [result.action] }],
    }),
    args,
    renderRemoteAdded(result.alias, result.available, result.selected),
  );
};

const remoteRemoveDispatch = (args: Args, paths: SkillPaths): CommandOutput => {
  const alias = args.positional[2];
  if (alias === undefined) throw new Error("usage: skctl remote remove <alias> [--dry-run]");
  const result = removeRemote(paths, loadManifest(paths.manifestPath), alias, args.dryRun);
  if (result.action.kind === "conflict" || args.dryRun) {
    return applyOutput(
      {
        verb: "remote remove",
        dryRun: args.dryRun,
        root: paths.sourceRepo,
        hosts: [...AllHosts],
        sections: [{ name: "remotes", actions: [result.action] }],
      },
      args,
    );
  }
  saveManifest(paths.manifestPath, result.manifest);
  return applyOutput(
    applyResult(paths, args, {
      verb: "remote remove",
      dryRun: false,
      refreshRemotes: false,
      leading: [{ name: "remotes", actions: [result.action] }],
    }),
    args,
    [`removed remote '${alias}'`],
  );
};

const remoteDispatch = (args: Args): CommandOutput => {
  const paths = resolveScope(args);
  switch (args.positional[1]) {
    case "add":
      return remoteAddDispatch(args, paths);
    case "remove":
    case "rm":
      return remoteRemoveDispatch(args, paths);
    case "list":
    case undefined:
      return remotesList(paths, args);
    default:
      throw new Error("usage: skctl remote add <url> [alias]|remove <alias>|list");
  }
};

const raycastDispatch = (args: Args): CommandOutput => {
  if (args.positional[1] !== "sync") throw new Error("usage: skctl raycast sync [--dir <path>]");
  const paths = resolveScope(args);
  const target = raycastTarget(args);
  return applyOutput(
    {
      verb: "raycast sync",
      dryRun: false,
      root: paths.sourceRepo,
      hosts: paths.commandHosts,
      sections: [
        {
          name: "raycast",
          note: shortPath(target),
          actions: syncRaycast(paths, target, loadConfig().activeTags),
        },
      ],
    },
    args,
  );
};

const browseDispatch = async (args: Args): Promise<CommandOutput> => {
  const paths = resolveScope(args);
  const result = await browse(paths, loadManifest(paths.manifestPath), {
    target: args.positional[1],
    interactive:
      process.stdin.isTTY === true && process.stdout.isTTY === true && args.output !== "json",
  });
  if (result.manifest === undefined) return { text: result.text, data: result.data };
  saveManifest(paths.manifestPath, result.manifest);
  return applyOutput(
    applyResult(paths, args, {
      verb: "browse",
      dryRun: false,
      refreshRemotes: false,
      leading: [{ name: "remotes", actions: result.actions ?? [] }],
    }),
    args,
    result.notices ?? [],
  );
};

const globalScope = (args: Args): SkillPaths => {
  const config = loadConfig();
  const { root } = resolveRoot({ flagRoot: args.root });
  return resolveSkillPaths(
    homedir(),
    root,
    undefined,
    undefined,
    undefined,
    config.instructionTargets,
  );
};

const projectReport = (
  target: ProjectTarget,
  report: ProjectReport,
  args: Args,
  verb: string,
  notices: string[],
): CommandOutput =>
  applyOutput(
    {
      verb,
      dryRun: args.dryRun,
      root: target.root,
      hosts: [...AllHosts],
      sections: [
        {
          name: "skills",
          note: `${report.config.mode} · ${report.selected.length} selected`,
          actions: report.actions,
        },
      ],
    },
    args,
    notices,
  );

const projectDispatch = (args: Args): CommandOutput => {
  const operation = args.positional[1] ?? "apply";
  const target = resolveProjectTarget(args.dir ?? process.cwd());
  const existing = loadProjectConfig(target);

  if (operation === "init") {
    const tags = args.tags?.split(",").map((tag) => tag.trim()).filter(Boolean) ?? [];
    const skills = args.skills?.split(",").map((name) => name.trim()).filter(Boolean) ?? [];
    if (tags.length === 0 && skills.length === 0) {
      throw new Error(
        "project init needs a selector; pass --tags <a,b> or --skills <x,y>",
      );
    }
    const paths = globalScope(args);
    const mode = args.projectMode ?? existing?.mode ?? "link";
    if (existing !== undefined && args.projectMode !== undefined && existing.mode !== mode) {
      throw new Error(
        `project already uses ${existing.mode} mode; run \`skctl project remove\` before changing modes`,
      );
    }
    const config: ProjectConfig = {
      from: paths.sourceRepo,
      tags,
      skills,
      mode,
      written: mode === "copy" ? existing?.written : undefined,
    };
    const report = reconcileProject(paths, target, config, args.dryRun);
    if (!args.dryRun) saveProjectConfig(target, report.config);
    return projectReport(target, report, args, "project init", [
      `projected ${report.selected.length} skill(s) from ${shortPath(paths.sourceRepo)}`,
      dim(`config: ${shortPath(target.configPath)}`),
    ]);
  }

  if (existing === undefined) {
    throw new Error(
      `no project config at ${shortPath(target.configPath)}\nrun \`skctl project init --tags <a,b>\` first`,
    );
  }
  const paths = globalScope({ ...args, root: args.root ?? existing.from });

  if (operation === "status") {
    const manifest = loadManifest(paths.manifestPath);
    const selected = selectForProject(paths, manifest, existing);
    return {
      text: renderDetails("project", shortPath(target.root), [
        ["from", shortPath(existing.from)],
        ["mode", existing.mode],
        ["tags", existing.tags.length > 0 ? existing.tags.join(", ") : dim(Marks.none)],
        ["skills", existing.skills.length > 0 ? existing.skills.join(", ") : dim(Marks.none)],
        ["selected", selected.map((entry) => entry.name)],
      ]),
      data: { target: target.root, config: existing, selected: selected.map((e) => e.name) },
    };
  }

  if (operation === "remove") {
    const actions = removeProject(target, existing, args.dryRun);
    return applyOutput(
      {
        verb: "project remove",
        dryRun: args.dryRun,
        root: target.root,
        hosts: [...AllHosts],
        sections: [{ name: "skills", actions }],
      },
      args,
      [`removed the projection in ${shortPath(target.root)}`],
    );
  }

  if (operation !== "apply") {
    throw new Error("usage: skctl project [apply]|init|status|remove");
  }
  const report = reconcileProject(paths, target, existing, args.dryRun);
  if (!args.dryRun) saveProjectConfig(target, report.config);
  return projectReport(target, report, args, "project", []);
};

const dispatch = async (args: Args): Promise<CommandOutput> => {
  if (args.version) {
    const parsed: unknown = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      typeof parsed.version !== "string"
    ) {
      throw new Error("package version is unavailable");
    }
    return { text: parsed.version, data: { version: parsed.version } };
  }
  if (args.help) return { text: renderUsage() };
  switch (args.positional[0]) {
    case "init":
      return initDispatch(args);
    case "config":
      return configDispatch(args);
    case "create":
      return createDispatch(args);
    case "get":
      return getDispatch(args);
    case "describe":
      return describeDispatch(args);
    case "apply":
      return applyDispatch(args);
    case "pull":
      return pullDispatch(args);
    case "refresh":
      return refreshDispatch(args);
    case "detach":
      return detachDispatch(args);
    case "tag":
      return tagDispatch(args, false);
    case "untag":
      return tagDispatch(args, true);
    case "enable":
      return toggleDispatch(args, true);
    case "disable":
      return toggleDispatch(args, false);
    case "import":
      return importDispatch(args);
    case "instruction":
    case "instructions":
      return instructionDispatch(args);
    case "schedule":
      return scheduleDispatch(args);
    case "status":
      return statusDispatch(args);
    case "remote":
    case "remotes":
      return remoteDispatch(args);
    case "browse":
      return browseDispatch(args);
    case "raycast":
      return raycastDispatch(args);
    case "project":
      return projectDispatch(args);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return { text: renderUsage() };
    default:
      throw new Error(
        `unknown command: ${args.positional[0]}\nRun \`skctl help\` for usage.`,
      );
  }
};

const main = async (argv: string[]): Promise<void> => {
  try {
    const args = parseArgs(argv);
    const json = args.output === "json";
    if (json) setColor(false);
    else if (args.color !== undefined) setColor(args.color);
    const result = await dispatch(args);
    if (json) console.log(JSON.stringify(result.data ?? {}, undefined, 2));
    else if (result.text) console.log(result.text);
    if ((result.conflicts ?? 0) > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(renderError(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
};

main(process.argv.slice(2));
