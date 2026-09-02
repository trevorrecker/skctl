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
  const destination = join(tmpdir(), "skctl-dest");
  assert.equal(
    destinationInstructionFile({ path: destination, type: "claude", kinds: ["instructions"] }),
    join(destination, "CLAUDE.md"),
  );
  assert.equal(
    destinationInstructionFile({ path: destination, type: "agents", kinds: ["instructions"] }),
    join(destination, "AGENTS.md"),
  );
});

test("legacy instruction targets migrate into destinations on read", () => {
  const home = join(tmpdir(), "skctl-legacy-home");
  const codex = join(home, ".codex");
  const claude = join(home, ".claude_t3");
  const codexTarget = join(codex, "AGENTS.md");
  const destinations = resolveDestinations({
    instructionTargets: [codexTarget, join(claude, "CLAUDE.md")],
  });
  assert.deepEqual(destinations, [
    { path: codex, type: "agents", kinds: ["instructions"] },
    { path: claude, type: "claude", kinds: ["instructions"] },
  ]);
  assert.equal(destinationInstructionFile(destinations[0]!), codexTarget);
});

test("resolveDestinations prefers explicit destinations over legacy targets", () => {
  const home = join(tmpdir(), "skctl-explicit-home");
  const dest = {
    path: join(home, ".claude"),
    type: "claude" as const,
    kinds: ["instructions" as const],
  };
  assert.deepEqual(
    resolveDestinations({
      destinations: [dest],
      instructionTargets: [join(home, ".codex", "AGENTS.md")],
    }),
    [dest],
  );
});

test("setDestinations finalizes the migration by dropping instructionTargets", () => {
  const config = {
    instructionTargets: [join(tmpdir(), "skctl-migration-home", ".codex", "AGENTS.md")],
  };
  const next = setDestinations(config, resolveDestinations(config));
  assert.equal(next.instructionTargets, undefined);
  assert.equal(next.destinations?.length, 1);
});
