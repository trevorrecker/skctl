import { join } from "node:path";
import { AgentSkillsSpecKeys } from "./types.js";
import type { Provider } from "./types.js";

// Claude Code reads only its own directory, and it is the widest of the four: everything in
// the spec plus its own invocation, model, and subagent controls.
export const Claude: Provider = {
  surface: "claude",
  title: "Claude Code",
  serves: ["claude"],
  readers: ["claude", "opencode", "cursor"],
  frontmatterKeys: [
    ...AgentSkillsSpecKeys,
    "when_to_use",
    "argument-hint",
    "arguments",
    "disallowed-tools",
    "disable-model-invocation",
    "user-invocable",
    "model",
    "effort",
    "context",
    "agent",
    "background",
    "hooks",
    "paths",
    "shell",
  ],
  userSkillsDir: (home) => join(home.claudeConfigDir, "skills"),
  projectSkillsDir: (root) => join(root, ".claude", "skills"),
  docs: "https://code.claude.com/docs/en/skills",
};
