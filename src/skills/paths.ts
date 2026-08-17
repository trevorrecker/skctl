import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AllHosts } from "./types.js";
import type { Host } from "./types.js";

export type Scope = "global" | "project";

export interface SkillPaths {
  scope: Scope;
  sourceRepo: string;
  sourceSkills: string;
  sourceCommands: string;
  remotesDir: string;
  manifestPath: string;
  instructionsSource: string;
  instructionImports: string[];
  instructionLinks: string[];
  agentsSkills: string;
  claudeSkills: string;
  skillLockPath: string;
  commandDirs: Record<Host, string>;
  commandHosts: Host[];
}

export const resolveSkillPaths = (
  home = homedir(),
  sourceRepo = join(home, "dev", "skills"),
  claudeConfigDir?: string,
  codexHome?: string,
  opencodeConfigDir?: string,
  additionalInstructionLinks: readonly string[] = [],
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
  return {
    scope: "global",
    sourceRepo,
    sourceSkills: join(sourceRepo, "skills"),
    sourceCommands: join(sourceRepo, "commands"),
    remotesDir: join(sourceRepo, "remotes"),
    manifestPath: join(sourceRepo, "skills.config.json"),
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
    agentsSkills: join(home, ".agents", "skills"),
    claudeSkills: join(resolvedClaudeConfigDir, "skills"),
    skillLockPath: join(home, ".agents", ".skill-lock.json"),
    commandDirs: {
      claude: join(resolvedClaudeConfigDir, "commands"),
      codex: join(resolvedCodexHome, "prompts"),
      opencode: join(resolvedOpencodeConfigDir, "commands"),
    },
    commandHosts: [...AllHosts],
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
    remotesDir: join(agents, "remotes"),
    manifestPath: join(agents, "skills.config.json"),
    instructionsSource: join(agents, "instructions", "AGENTS.md"),
    instructionImports: [],
    instructionLinks: [],
    agentsSkills: skills,
    claudeSkills: join(root, ".claude", "skills"),
    skillLockPath: join(agents, ".skill-lock.json"),
    commandDirs: {
      claude: join(root, ".claude", "commands"),
      codex: join(root, ".codex", "prompts"),
      opencode: join(root, ".opencode", "commands"),
    },
    commandHosts: ["claude", "opencode"],
  };
};
