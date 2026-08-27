import { join } from "node:path";
import type { Provider } from "./types.js";

// The one directory only OpenCode reads, which makes it the sole way to give OpenCode
// content no other client sees. OpenCode ignores frontmatter it does not know, so this list
// is about keeping the file clean rather than avoiding an error.
export const OpenCode: Provider = {
  surface: "opencode",
  title: "OpenCode",
  serves: ["opencode"],
  readers: ["opencode"],
  frontmatterKeys: ["name", "description", "license", "compatibility", "metadata"],
  userSkillsDir: (home) => join(home.opencodeConfigDir, "skills"),
  projectSkillsDir: (root) => join(root, ".opencode", "skills"),
  docs: "https://opencode.ai/docs/skills/",
};
