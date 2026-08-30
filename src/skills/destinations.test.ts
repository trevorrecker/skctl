import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  destinationInstructionFile,
  detectType,
  surfaceForClient,
} from "./destinations.js";
import { resolveDestinations, setDestinations } from "../config.js";

test("detectType claims a client from a config marker or a name", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-dest-"));
  const claudeDir = join(home, "work-claude");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, "CLAUDE.md"), "x\n");

  assert.equal(detectType(claudeDir), "claude");
  assert.equal(detectType(join(home, ".claude-alt")), "claude");
  assert.equal(detectType(join(home, "my-codex")), "agents");
  assert.equal(detectType(join(home, "opencode-2")), "opencode");
  assert.equal(detectType(join(home, "cursor-x")), "cursor");
  assert.equal(detectType(join(home, "mystery")), undefined);
});

test("surfaceForClient maps client names, codex onto the agents surface", () => {
  assert.equal(surfaceForClient("codex"), "agents");
  assert.equal(surfaceForClient("claude"), "claude");
  assert.equal(surfaceForClient("opencode"), "opencode");
  assert.equal(surfaceForClient("nope"), undefined);
});

test("destinationInstructionFile picks CLAUDE.md only for claude", () => {
  assert.equal(
    destinationInstructionFile({ path: "/x", type: "claude", kinds: ["instructions"] }),
    "/x/CLAUDE.md",
  );
  assert.equal(
    destinationInstructionFile({ path: "/x", type: "agents", kinds: ["instructions"] }),
    "/x/AGENTS.md",
  );
});

test("legacy instruction targets migrate into destinations on read", () => {
  const destinations = resolveDestinations({
    instructionTargets: ["/home/.codex/AGENTS.md", "/home/.claude_t3/CLAUDE.md"],
  });
  assert.deepEqual(destinations, [
    { path: "/home/.codex", type: "agents", kinds: ["instructions"] },
    { path: "/home/.claude_t3", type: "claude", kinds: ["instructions"] },
  ]);
  assert.equal(destinationInstructionFile(destinations[0]!), "/home/.codex/AGENTS.md");
});

test("resolveDestinations prefers explicit destinations over legacy targets", () => {
  const dest = { path: "/a", type: "claude" as const, kinds: ["instructions" as const] };
  assert.deepEqual(
    resolveDestinations({ destinations: [dest], instructionTargets: ["/home/.codex/AGENTS.md"] }),
    [dest],
  );
});

test("setDestinations finalizes the migration by dropping instructionTargets", () => {
  const config = { instructionTargets: ["/home/.codex/AGENTS.md"] };
  const next = setDestinations(config, resolveDestinations(config));
  assert.equal(next.instructionTargets, undefined);
  assert.equal(next.destinations?.length, 1);
});
