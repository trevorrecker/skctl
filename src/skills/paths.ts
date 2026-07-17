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
  agentsSkills: string;
  claudeSkills: string;
  skillLockPath: string;
  commandDirs: Record<Host, string>;
  commandHosts: Host[];
}

export const resolveSkillPaths = (
  home: string = homedir(),
  sourceRepo: string = join(home, "dev", "skills"),
): SkillPaths => ({
  scope: "global",
  sourceRepo,
  sourceSkills: join(sourceRepo, "skills"),
  sourceCommands: join(sourceRepo, "commands"),
  remotesDir: join(sourceRepo, "remotes"),
  manifestPath: join(sourceRepo, "skills.config.json"),
  agentsSkills: join(home, ".agents", "skills"),
  claudeSkills: join(home, ".claude", "skills"),
  skillLockPath: join(home, ".agents", ".skill-lock.json"),
  commandDirs: {
    claude: join(home, ".claude", "commands"),
    codex: join(home, ".codex", "prompts"),
    opencode: join(home, ".config", "opencode", "commands"),
  },
  commandHosts: [...AllHosts],
});

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
