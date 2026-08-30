import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { surfaceForInstructionFile } from "./paths.js";
import type { Surface } from "./types.js";

// A destination is an additional place skctl materializes content: another client home or
// config directory beyond the primary one. It always knows its client type, which decides
// the instruction filename and (later) the skills and command layout. This first cut manages
// instructions only; skills and commands land in a follow-up.
export type DestinationKind = "instructions";

export interface Destination {
  path: string;
  type: Surface;
  kinds: DestinationKind[];
}

// A client reads a distinctly named instruction file. Only Claude uses CLAUDE.md; every other
// client follows the AGENTS convention.
export const destinationInstructionFile = (destination: Destination): string =>
  join(destination.path, destination.type === "claude" ? "CLAUDE.md" : "AGENTS.md");

// Detection claims a type outright when it recognizes a config, so `--as` is only ever an
// override. A directory that holds a CLAUDE.md, or is named for Claude, is Claude; an
// AGENTS.md or a codex/opencode/cursor name resolves the same way. Undetected paths return
// undefined so the caller can ask for `--as`.
export const detectType = (path: string): Surface | undefined => {
  const name = basename(path).toLowerCase();
  if (existsSync(join(path, "CLAUDE.md")) || name.includes("claude")) return "claude";
  if (name.includes("codex")) return "agents";
  if (name.includes("opencode")) return "opencode";
  if (name.includes("cursor")) return "cursor";
  if (existsSync(join(path, "AGENTS.md"))) return "agents";
  return undefined;
};

// `--as` takes a client name, not a surface, and Codex writes into the shared agents surface.
export const surfaceForClient = (name: string): Surface | undefined => {
  switch (name) {
    case "claude":
      return "claude";
    case "codex":
    case "agents":
      return "agents";
    case "opencode":
      return "opencode";
    case "cursor":
      return "cursor";
    default:
      return undefined;
  }
};

// Machine-local instruction targets used to be bare file paths. Each becomes a destination
// whose directory holds the file and whose type is read from the filename, so an upgrade
// keeps materializing the exact same files.
export const destinationFromInstructionTarget = (target: string): Destination => ({
  path: join(target, ".."),
  type: surfaceForInstructionFile(target),
  kinds: ["instructions"],
});
