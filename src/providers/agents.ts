import { join } from "node:path";
import { AgentSkillsSpecKeys } from "./types.js";
import type { Provider } from "./types.js";

// ~/.agents/skills is the only user-level path Codex reads, and OpenCode and Cursor both
// read it too. Nothing here may step outside the Agent Skills spec, because this is the
// content most likely to be uploaded or packaged later.
export const Agents: Provider = {
  surface: "agents",
  title: "Agent Skills (Codex)",
  serves: ["codex"],
  readers: ["codex", "opencode", "cursor"],
  frontmatterKeys: AgentSkillsSpecKeys,
  userSkillsDir: (home) => join(home.home, ".agents", "skills"),
  projectSkillsDir: (root) => join(root, ".agents", "skills"),
  docs: "https://learn.chatgpt.com/docs/build-skills",
};
