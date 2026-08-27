import { join } from "node:path";
import type { Provider } from "./types.js";

// Cursor reads every other surface for compatibility, so this directory is the only place it
// sees alone. Its accepted keys are not a superset of the spec: it takes `paths` and
// `disable-model-invocation`, but not `license`, `compatibility`, or `allowed-tools`.
export const Cursor: Provider = {
  surface: "cursor",
  title: "Cursor",
  serves: ["cursor"],
  readers: ["cursor"],
  frontmatterKeys: [
    "name",
    "description",
    "paths",
    "disable-model-invocation",
    "icon",
    "color",
    "metadata",
  ],
  userSkillsDir: (home) => join(home.cursorConfigDir, "skills"),
  projectSkillsDir: (root) => join(root, ".cursor", "skills"),
  docs: "https://cursor.com/docs/skills",
};
