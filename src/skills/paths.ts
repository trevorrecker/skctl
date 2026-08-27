import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { projectSkillsDirs, userSkillsDirs } from "../providers/index.js";
import { CommandHosts } from "./types.js";
import type { CommandHost, Surface } from "./types.js";

export type Scope = "global" | "project";

export interface SkillPaths {
  scope: Scope;
  sourceRepo: string;
  sourceSkills: string;
  sourceCommands: string;
  overlaysDir: string;
  buildDir: string;
  remotesDir: string;
  manifestPath: string;
  gitignorePath: string;
  instructionsSource: string;
  instructionImports: string[];
  instructionLinks: string[];
  surfaceDirs: Record<Surface, string>;
  skillLockPath: string;
  commandDirs: Record<CommandHost, string>;
  commandHosts: CommandHost[];
}

export const surfaceBuildDir = (paths: SkillPaths, surface: Surface): string =>
  join(paths.buildDir, surface);

// Where a subset of a global root is projected to. Distinct from resolveProjectPaths, which
// treats <dir>/.agents as the source; here the source stays global and the project directory
// is only an output.
export interface ProjectTarget {
  root: string;
  configPath: string;
  buildDir: string;
  gitignorePath: string;
  surfaceDirs: Record<Surface, string>;
}

export const ProjectConfigName = "skctl.project.json";

export const resolveProjectTarget = (projectDir: string): ProjectTarget => {
  const root = resolve(projectDir);
  return {
    root,
    configPath: join(root, ".agents", ProjectConfigName),
    buildDir: join(root, ".agents", ".build"),
    gitignorePath: join(root, ".gitignore"),
    surfaceDirs: projectSkillsDirs(root),
  };
};

export const resolveSkillPaths = (
  home = homedir(),
  sourceRepo = join(home, "dev", "skills"),
  claudeConfigDir?: string,
  codexHome?: string,
  opencodeConfigDir?: string,
  additionalInstructionLinks: readonly string[] = [],
  cursorConfigDir?: string,
): SkillPaths => {
  const useEnvironment = home === homedir();
  const resolvedClaudeConfigDir =
    claudeConfigDir ??
    (useEnvironment ? process.env.CLAUDE_CONFIG_DIR : undefined) ??
    join(home, ".claude");
  const resolvedCodexHome =
    codexHome ??
    (useEnvironment ? process.env.CODEX_HOME : undefined) ??
    join(home, ".codex");
  const resolvedOpencodeConfigDir =
    opencodeConfigDir ??
    (useEnvironment ? process.env.OPENCODE_CONFIG_DIR : undefined) ??
    join(home, ".config", "opencode");
  const resolvedCursorConfigDir =
    cursorConfigDir ??
    (useEnvironment ? process.env.CURSOR_CONFIG_DIR : undefined) ??
    join(home, ".cursor");
  return {
    scope: "global",
    sourceRepo,
    sourceSkills: join(sourceRepo, "skills"),
    sourceCommands: join(sourceRepo, "commands"),
    overlaysDir: join(sourceRepo, "overlays"),
    buildDir: join(sourceRepo, ".build"),
    remotesDir: join(sourceRepo, "remotes"),
    manifestPath: join(sourceRepo, "skills.config.json"),
    gitignorePath: join(sourceRepo, ".gitignore"),
    instructionsSource: join(sourceRepo, "instructions", "AGENTS.md"),
    instructionImports: [join(home, "AGENTS.md"), join(home, "CLAUDE.md")],
    instructionLinks: [
      ...new Set([
        join(resolvedClaudeConfigDir, "CLAUDE.md"),
        join(resolvedCodexHome, "AGENTS.md"),
        join(resolvedOpencodeConfigDir, "AGENTS.md"),
        ...additionalInstructionLinks,
      ]),
    ],
    surfaceDirs: userSkillsDirs({
      home,
      claudeConfigDir: resolvedClaudeConfigDir,
      codexHome: resolvedCodexHome,
      opencodeConfigDir: resolvedOpencodeConfigDir,
      cursorConfigDir: resolvedCursorConfigDir,
    }),
    skillLockPath: join(home, ".agents", ".skill-lock.json"),
    commandDirs: {
      claude: join(resolvedClaudeConfigDir, "commands"),
      codex: join(resolvedCodexHome, "prompts"),
      opencode: join(resolvedOpencodeConfigDir, "commands"),
    },
    commandHosts: [...CommandHosts],
  };
};

export const resolveProjectPaths = (projectDir: string): SkillPaths => {
  const root = resolve(projectDir);
  const agents = join(root, ".agents");
  const skills = join(agents, "skills");
  return {
    scope: "project",
    sourceRepo: agents,
    sourceSkills: skills,
    sourceCommands: join(agents, "commands"),
    overlaysDir: join(agents, "overlays"),
    buildDir: join(agents, ".build"),
    remotesDir: join(agents, "remotes"),
    manifestPath: join(agents, "skills.config.json"),
    gitignorePath: join(agents, ".gitignore"),
    instructionsSource: join(agents, "instructions", "AGENTS.md"),
    instructionImports: [],
    instructionLinks: [],
    surfaceDirs: projectSkillsDirs(root),
    skillLockPath: join(agents, ".skill-lock.json"),
    commandDirs: {
      claude: join(root, ".claude", "commands"),
      codex: join(root, ".codex", "prompts"),
      opencode: join(root, ".opencode", "commands"),
    },
    commandHosts: ["claude", "opencode"],
  };
};
