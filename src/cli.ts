#!/usr/bin/env node
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  commandContent,
  listCommands,
  listSkills,
  skillContent,
} from "./skills/inspect.js";
import { doctor } from "./skills/doctor.js";
import { importLooseSkills } from "./skills/import.js";
import { createCommand, createSkill, validateName } from "./skills/create.js";
import { loadManifest, saveManifest, setEnabled, setHosts } from "./skills/manifest.js";
import { resolveProjectPaths, resolveSkillPaths } from "./skills/paths.js";
import { listRemotes, updateRemotes } from "./skills/remotes.js";
import { sync } from "./skills/sync.js";
import { AllHosts } from "./skills/types.js";
import type { CommandInfo, SkillInfo } from "./skills/inspect.js";
import type { SkillPaths } from "./skills/paths.js";
import type { Action, Collection, Host } from "./skills/types.js";
import { configPath, initRoot, loadConfig, resolveRoot, saveConfig } from "./config.js";
import { defaultRaycastDir, syncRaycast } from "./raycast.js";

const usage = `skctl — manage portable agent skills & commands across hosts

Usage:
  skctl init [dir]                      scaffold + register a skills root (default: cwd)
  skctl config [set root|raycast <dir>] show or update configuration
  skctl create skill|command [name]     scaffold a new source file (interactive if name omitted)
  skctl get skills|commands|remotes [name] [-o wide|name|json]
  skctl get skill|command <name> -o body|raw   print body (default) or whole file
  skctl describe skill|command <name>   detailed view
  skctl apply [--dry-run] [--no-raycast]       reconcile manifest into every host
  skctl pull [remote]                   clone/fast-forward remotes, then apply
  skctl enable  skill|command <name>
  skctl disable skill|command <name>
  skctl import [--dry-run]              adopt loose ~/.agents/skills dirs into the root
  skctl status                          report drift (read-only)
  skctl raycast sync [--dir <path>]     regenerate Raycast script commands

Global flags: --root <dir> (override skills root), --project[=DIR] (operate on <DIR>/.agents)
create flags: -d/--description <text>, --body <text|-> (- reads stdin), --hosts a,b,c,
  --argument-hint <text> (commands), --no-paste (skills), --apply, --force
Root resolution: --root > SKCTL_ROOT > ~/.config/skctl/config.json`;

interface Args {
  positional: string[];
  root?: string;
  project?: string | true;
  output?: string;
  dir?: string;
  description?: string;
  body?: string;
  argumentHint?: string;
  hosts?: string;
  dryRun: boolean;
  paste: boolean;
  noPaste: boolean;
  noRaycast: boolean;
  apply: boolean;
  force: boolean;
}

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    positional: [],
    dryRun: false,
    paste: false,
    noPaste: false,
    noRaycast: false,
    apply: false,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = (inline?: string): string => inline ?? argv[(index += 1)];
    if (token === "--dry-run") args.dryRun = true;
    else if (token === "--paste") args.paste = true;
    else if (token === "--no-paste") args.noPaste = true;
    else if (token === "--no-raycast") args.noRaycast = true;
    else if (token === "--apply") args.apply = true;
    else if (token === "--force") args.force = true;
    else if (token === "--project") args.project = true;
    else if (token.startsWith("--project=")) args.project = token.slice("--project=".length);
    else if (token === "--root") args.root = value();
    else if (token.startsWith("--root=")) args.root = token.slice("--root=".length);
    else if (token === "--dir") args.dir = value();
    else if (token.startsWith("--dir=")) args.dir = token.slice("--dir=".length);
    else if (token === "-d" || token === "--description") args.description = value();
    else if (token.startsWith("-d=")) args.description = token.slice("-d=".length);
    else if (token.startsWith("--description=")) args.description = token.slice("--description=".length);
    else if (token === "--body") args.body = value();
    else if (token.startsWith("--body=")) args.body = token.slice("--body=".length);
    else if (token === "--argument-hint" || token === "--arg-hint") args.argumentHint = value();
    else if (token.startsWith("--argument-hint=")) args.argumentHint = token.slice("--argument-hint=".length);
    else if (token === "--hosts") args.hosts = value();
    else if (token.startsWith("--hosts=")) args.hosts = token.slice("--hosts=".length);
    else if (token === "-o" || token === "--output") args.output = value();
    else if (token.startsWith("-o=")) args.output = token.slice("-o=".length);
    else if (token.startsWith("--output=")) args.output = token.slice("--output=".length);
    else args.positional.push(token);
  }
  return args;
};

const resolveScope = (args: Args): SkillPaths => {
  if (args.project !== undefined) {
    const dir = typeof args.project === "string" ? args.project : process.cwd();
    return resolveProjectPaths(dir);
  }
  const { root } = resolveRoot({ flagRoot: args.root });
  return resolveSkillPaths(homedir(), root);
};

type Resource = "skills" | "commands" | "remotes";

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
    default:
      return undefined;
  }
};

const OutputFormats = ["wide", "name", "json", "body", "raw"] as const;
type OutFmt = (typeof OutputFormats)[number];

const parseOutput = (output: string | undefined): OutFmt => {
  const value = output ?? "wide";
  if ((OutputFormats as readonly string[]).includes(value)) return value as OutFmt;
  throw new Error(`unknown output format '${output}' (use ${OutputFormats.join("|")})`);
};

const prefix = (dryRun: boolean): string => (dryRun ? "[dry-run] " : "");

const summarizeActions = (actions: Action[]): string => {
  const counts = new Map<string, number>();
  for (const action of actions) {
    counts.set(action.kind, (counts.get(action.kind) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .map(([kind, count]) => `${kind}=${count}`)
    .join(" ");
  const notable = actions
    .filter((action) => action.kind !== "ok")
    .map((action) => `  ${action.kind === "conflict" ? "!" : "·"} ${action.detail}`);
  return [summary || "nothing to do", ...notable].join("\n");
};

const skillRow = (info: SkillInfo): string => {
  const mark = info.enabled ? "●" : "○";
  const target = info.enabled ? info.hosts.join(",") : "disabled";
  const remote = info.remote ? `  [${info.remote}]` : "";
  const paste = info.paste ? "  [paste]" : "";
  return `  ${mark} ${info.name.padEnd(22)} ${target}${remote}${paste}`;
};

const commandRow = (info: CommandInfo): string => {
  const mark = info.enabled ? "●" : "○";
  const target = info.enabled ? info.hosts.join(",") : "disabled";
  return `  ${mark} ${info.name.padEnd(22)} ${target}`;
};

const requireList = (fmt: OutFmt): void => {
  if (fmt === "body" || fmt === "raw") {
    throw new Error("-o body|raw requires a single <name>");
  }
};

const skillsList = (paths: SkillPaths, args: Args): string => {
  const fmt = parseOutput(args.output);
  requireList(fmt);
  const skills = listSkills(paths, args.paste);
  if (fmt === "name") return skills.map((skill) => skill.name).join("\n");
  if (fmt === "json") return JSON.stringify(skills, null, 2);
  if (skills.length === 0) return args.paste ? "No paste-flagged skills." : "No skills.";
  return [`${skills.length} skill(s) — ● enabled  ○ disabled`, ...skills.map(skillRow)].join("\n");
};

const commandsList = (paths: SkillPaths, args: Args): string => {
  const fmt = parseOutput(args.output);
  requireList(fmt);
  const commands = listCommands(paths);
  if (fmt === "name") return commands.map((command) => command.name).join("\n");
  if (fmt === "json") return JSON.stringify(commands, null, 2);
  if (commands.length === 0) return "No commands.";
  return [`${commands.length} command(s) — ● enabled  ○ disabled`, ...commands.map(commandRow)].join("\n");
};

const remotesList = (paths: SkillPaths, args: Args): string => {
  const fmt = parseOutput(args.output);
  requireList(fmt);
  const remotes = listRemotes(paths, loadManifest(paths.manifestPath));
  if (fmt === "name") return remotes.map((remote) => remote.alias).join("\n");
  if (fmt === "json") return JSON.stringify(remotes, null, 2);
  if (remotes.length === 0) return "No remotes.";
  const rows = remotes.map((remote) => {
    const state = remote.cloned
      ? remote.head
        ? `cloned@${remote.head}`
        : "cloned"
      : "not cloned";
    return `  ${remote.alias.padEnd(16)} ${remote.url}  (${remote.skills.length} skills, ${state})`;
  });
  return [`${remotes.length} remote(s)`, ...rows].join("\n");
};

const getSkill = (paths: SkillPaths, name: string, fmt: OutFmt): string => {
  const info = listSkills(paths).find((skill) => skill.name === name);
  if (!info) throw new Error(`unknown skill: ${name}`);
  switch (fmt) {
    case "body":
      return skillContent(paths, name, false);
    case "raw":
      return skillContent(paths, name, true);
    case "name":
      return info.name;
    case "json":
      return JSON.stringify(info, null, 2);
    default:
      return skillRow(info);
  }
};

const getCommand = (paths: SkillPaths, name: string, fmt: OutFmt): string => {
  const info = listCommands(paths).find((command) => command.name === name);
  if (!info) throw new Error(`unknown command: ${name}`);
  switch (fmt) {
    case "body":
      return commandContent(paths, name, false);
    case "raw":
      return commandContent(paths, name, true);
    case "name":
      return info.name;
    case "json":
      return JSON.stringify(info, null, 2);
    default:
      return commandRow(info);
  }
};

const getRemote = (paths: SkillPaths, name: string, fmt: OutFmt): string => {
  const info = listRemotes(paths, loadManifest(paths.manifestPath)).find(
    (remote) => remote.alias === name,
  );
  if (!info) throw new Error(`unknown remote: ${name}`);
  if (fmt === "body" || fmt === "raw") throw new Error("-o body|raw not valid for remotes");
  if (fmt === "name") return info.alias;
  if (fmt === "json") return JSON.stringify(info, null, 2);
  const state = info.cloned ? (info.head ? `cloned@${info.head}` : "cloned") : "not cloned";
  return [
    `remote: ${info.alias}`,
    `url: ${info.url}`,
    `state: ${state}`,
    `skills: ${info.skills.join(", ") || "(none)"}`,
  ].join("\n");
};

const describeText = (paths: SkillPaths, resource: Resource, name: string): string => {
  if (resource === "remotes") return getRemote(paths, name, "wide");
  if (resource === "commands") {
    const info = listCommands(paths).find((command) => command.name === name);
    if (!info) throw new Error(`unknown command: ${name}`);
    return [
      `command: ${info.name}`,
      `enabled: ${info.enabled}`,
      `hosts: ${info.hosts.join(", ")}`,
      `path: ${info.path}`,
      "",
      info.description || "(no description)",
    ].join("\n");
  }
  const info = listSkills(paths).find((skill) => skill.name === name);
  if (!info) throw new Error(`unknown skill: ${name}`);
  return [
    `skill: ${info.name}`,
    `enabled: ${info.enabled}`,
    `hosts: ${info.hosts.join(", ")}`,
    ...(info.remote ? [`remote: ${info.remote}`] : []),
    `paste: ${info.paste}`,
    `path: ${info.path}`,
    "",
    info.description || "(no description)",
  ].join("\n");
};

const raycastTarget = (args: Args): string =>
  args.dir ?? loadConfig().raycastDir ?? defaultRaycastDir();

const applyText = (
  paths: SkillPaths,
  args: Args,
  opts: { dryRun: boolean },
): string => {
  const report = sync(paths, loadManifest(paths.manifestPath), opts.dryRun);
  const sections = [
    `${prefix(opts.dryRun)}skills\n${summarizeActions(report.skills)}`,
    `${prefix(opts.dryRun)}commands\n${summarizeActions(report.commands)}`,
  ];
  if (!opts.dryRun && !args.noRaycast && paths.scope === "global") {
    const target = raycastTarget(args);
    sections.push(`raycast (${target})\n${summarizeActions(syncRaycast(paths, target))}`);
  }
  return sections.join("\n\n");
};

const pullText = (paths: SkillPaths, args: Args, alias: string | undefined): string => {
  const manifest = loadManifest(paths.manifestPath);
  if (Object.keys(manifest.remotes).length === 0) {
    return "no remotes configured (add a `remotes` section to skills.config.json)";
  }
  const actions = updateRemotes(paths, manifest, alias);
  return [`remotes\n${summarizeActions(actions)}`, "", applyText(paths, args, { dryRun: false })].join("\n");
};

const toggleText = (args: Args, enabled: boolean): string => {
  const resource = resolveResource(args.positional[1]);
  const name = args.positional[2];
  const verb = enabled ? "enable" : "disable";
  if (resource !== "skills" && resource !== "commands") {
    throw new Error(`usage: skctl ${verb} skill|command <name>`);
  }
  if (!name) throw new Error(`usage: skctl ${verb} skill|command <name>`);
  const paths = resolveScope(args);
  const collection: Collection = resource;
  saveManifest(
    paths.manifestPath,
    setEnabled(loadManifest(paths.manifestPath), collection, name, enabled),
  );
  return [
    `${enabled ? "enabled" : "disabled"} ${collection.slice(0, -1)} '${name}'`,
    "",
    applyText(paths, args, { dryRun: false }),
  ].join("\n");
};

const importText = (paths: SkillPaths, args: Args): string => {
  const report = importLooseSkills(paths, args.dryRun);
  const lines = [
    `${prefix(args.dryRun)}imported ${report.imported.length} skill(s): ${report.imported.join(", ") || "none"}`,
  ];
  if (report.skipped.length > 0) {
    lines.push("skipped:", ...report.skipped.map((action) => `  · ${action.detail}`));
  }
  if (!args.dryRun && report.imported.length > 0) {
    lines.push("", applyText(paths, args, { dryRun: false }));
  }
  return lines.join("\n");
};

const statusText = (paths: SkillPaths): string => {
  const report = doctor(paths);
  const lines = [
    `source: ${report.sourceSkillCount} skills, ${report.sourceCommandCount} commands (${paths.sourceRepo})`,
    "",
    report.issues.length > 0 ? "Issues:" : "Issues: none",
    ...report.issues.map((issue) => `  ! ${issue}`),
  ];
  if (report.notes.length > 0) {
    lines.push("", "Notes:", ...report.notes.map((note) => `  · ${note}`));
  }
  return lines.join("\n");
};

const initText = (args: Args): string => {
  const { root, created } = initRoot(args.positional[1] ?? process.cwd());
  return [
    `registered root: ${root}`,
    created.length > 0 ? `created: ${created.join(", ")}` : "already scaffolded",
  ].join("\n");
};

const configText = (args: Args): string => {
  if (args.positional[1] === "set") {
    const key = args.positional[2];
    const value = args.positional[3];
    if (!value || (key !== "root" && key !== "raycast" && key !== "raycastDir")) {
      throw new Error("usage: skctl config set root|raycast <dir>");
    }
    const config = loadConfig();
    if (key === "root") config.root = resolve(value);
    else config.raycastDir = resolve(value);
    saveConfig(config);
    return `set ${key === "raycastDir" ? "raycast" : key} = ${resolve(value)}`;
  }
  const config = loadConfig();
  let rootLine: string;
  try {
    const resolved = resolveRoot({ flagRoot: args.root });
    rootLine = `root: ${resolved.root} (source: ${resolved.source})`;
  } catch {
    rootLine = "root: (unset) — run `skctl init <dir>` or set SKCTL_ROOT";
  }
  return [
    rootLine,
    `raycast dir: ${config.raycastDir ?? `${defaultRaycastDir()} (default)`}`,
    `config file: ${configPath()}`,
  ].join("\n");
};

const getText = (args: Args): string => {
  const resource = resolveResource(args.positional[1]);
  if (!resource) throw new Error("usage: skctl get skills|commands|remotes [name]");
  const name = args.positional[2];
  const paths = resolveScope(args);
  const fmt = parseOutput(args.output);
  if (resource === "skills") return name ? getSkill(paths, name, fmt) : skillsList(paths, args);
  if (resource === "commands") return name ? getCommand(paths, name, fmt) : commandsList(paths, args);
  return name ? getRemote(paths, name, fmt) : remotesList(paths, args);
};

const describeDispatch = (args: Args): string => {
  const resource = resolveResource(args.positional[1]);
  const name = args.positional[2];
  if (!resource || !name) throw new Error("usage: skctl describe skill|command <name>");
  return describeText(resolveScope(args), resource, name);
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
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
};

const parseHostList = (value: string | undefined): Host[] | undefined => {
  if (value === undefined) return undefined;
  const hosts = value.split(",").map((host) => host.trim()).filter(Boolean);
  const invalid = hosts.filter((host) => !(AllHosts as readonly string[]).includes(host));
  if (invalid.length > 0) {
    throw new Error(`unknown host(s): ${invalid.join(", ")} (valid: ${AllHosts.join(", ")})`);
  }
  return hosts as Host[];
};

const createDispatch = async (args: Args): Promise<string> => {
  const resource = resolveResource(args.positional[1]);
  if (resource !== "skills" && resource !== "commands") {
    throw new Error("usage: skctl create skill|command [name] [-d desc] [--body text] ...");
  }
  const paths = resolveScope(args);
  const interactive = process.stdin.isTTY === true;
  const body = args.body === "-" ? await readStdin() : args.body;
  const hosts = parseHostList(args.hosts);

  let name = args.positional[2];
  if (!name && interactive) name = (await prompt("name: ")).trim();
  if (!name) throw new Error("create requires a <name> — pass it as an argument or run in a terminal");
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

  const lines = [`created ${collection.slice(0, -1)} '${name}' at ${dest}`];
  if (hosts) {
    saveManifest(paths.manifestPath, setHosts(loadManifest(paths.manifestPath), collection, name, hosts));
    lines.push(`hosts: ${hosts.join(", ")}`);
  }
  if (args.apply) {
    lines.push("", applyText(paths, args, { dryRun: false }));
  } else {
    const projectFlag = paths.scope === "project" ? " --project" : "";
    lines.push(`run 'skctl apply${projectFlag}' to materialize it into hosts`);
  }
  return lines.join("\n");
};

const raycastDispatch = (args: Args): string => {
  if (args.positional[1] !== "sync") throw new Error("usage: skctl raycast sync [--dir <path>]");
  const paths = resolveScope(args);
  const target = raycastTarget(args);
  return `raycast (${target})\n${summarizeActions(syncRaycast(paths, target))}`;
};

const run = async (argv: string[]): Promise<string> => {
  const args = parseArgs(argv);
  const command = args.positional[0];
  switch (command) {
    case "init":
      return initText(args);
    case "config":
      return configText(args);
    case "create":
      return createDispatch(args);
    case "get":
      return getText(args);
    case "describe":
      return describeDispatch(args);
    case "apply":
      return applyText(resolveScope(args), args, { dryRun: args.dryRun });
    case "pull":
      return pullText(resolveScope(args), args, args.positional[1]);
    case "enable":
      return toggleText(args, true);
    case "disable":
      return toggleText(args, false);
    case "import":
      return importText(resolveScope(args), args);
    case "status":
      return statusText(resolveScope(args));
    case "raycast":
      return raycastDispatch(args);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return usage;
    default:
      throw new Error(`unknown command: ${command}\nRun 'skctl help' for usage.`);
  }
};

run(process.argv.slice(2))
  .then((output) => {
    if (output) console.log(output);
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
