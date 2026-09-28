import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { parseOverlay } from "./overlays.js";
import type { Overlay } from "./overlays.js";
import type { SkillPaths } from "./paths.js";

export interface RestoredSkill {
  // Holds the extracted files; the caller removes it once the copy is written.
  scratch: string;
  skillDir: string;
  overlay?: Overlay;
  commit: string;
}

const git = (repo: string, args: string[], env: NodeJS.ProcessEnv = process.env): string =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf-8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

const exists = (repo: string, revision: string, path: string): boolean => {
  try {
    git(repo, ["cat-file", "-e", `${revision}:${path}`]);
    return true;
  } catch {
    return false;
  }
};

const repoPath = (paths: SkillPaths, path: string): string =>
  relative(paths.sourceRepo, path).split(sep).join("/");

// The last commit that touched the skill either still has it (removed in the working tree
// only) or is the commit that deleted it, whose parent has it.
export const restoreFromHistory = (
  paths: SkillPaths,
  name: string,
): RestoredSkill | undefined => {
  const repo = paths.sourceRepo;
  const skillPath = repoPath(paths, join(paths.sourceSkills, name));
  const overlayPath = repoPath(paths, join(paths.overlaysDir, `${name}.md`));
  let scratch: string | undefined;
  try {
    const last = git(repo, ["rev-list", "-1", "HEAD", "--", skillPath]).trim();
    if (last === "") return undefined;
    const revision = exists(repo, last, `${skillPath}/SKILL.md`) ? last : `${last}^`;
    if (!exists(repo, revision, `${skillPath}/SKILL.md`)) return undefined;
    scratch = mkdtempSync(join(tmpdir(), "skctl-restore-"));
    const skillDir = join(scratch, name);
    // A throwaway index keeps the repository's own index untouched, and checkout-index
    // writes file modes and links the way git stored them without needing tar on PATH.
    const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
    git(repo, ["read-tree", `${revision}:${skillPath}`], env);
    // The prefix is prepended to each path as a raw string, and Git for Windows only treats
    // forward slashes in it as separators reliably.
    git(repo, ["checkout-index", "--all", `--prefix=${skillDir.split(sep).join("/")}/`], env);
    const overlayFile = join(scratch, `${name}.md`);
    if (exists(repo, revision, overlayPath)) {
      writeFileSync(overlayFile, git(repo, ["show", `${revision}:${overlayPath}`]), "utf-8");
    }
    return {
      scratch,
      skillDir,
      overlay: existsSync(overlayFile)
        ? parseOverlay(name, overlayFile, readFileSync(overlayFile, "utf-8"), [])
        : undefined,
      commit: git(repo, ["rev-parse", "--short", revision]).trim(),
    };
  } catch {
    // No repository, no history for the path, or no git on PATH. The caller falls back to
    // the last build and says what it could not recover.
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
    return undefined;
  }
};
