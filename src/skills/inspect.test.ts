import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolveSkillPaths } from "./paths.js";
import { defaultManifest, saveManifest, setEnabled } from "./manifest.js";
import { listCommands, listSkills, skillContent } from "./inspect.js";

const seed = (home: string): void => {
  const paths = resolveSkillPaths(home);
  mkdirSync(paths.sourceSkills, { recursive: true });
  mkdirSync(join(paths.sourceSkills, "normal"), { recursive: true });
  writeFileSync(
    join(paths.sourceSkills, "normal", "SKILL.md"),
    "---\nname: normal\ndescription: a normal skill\n---\n\nNormal body.\n",
  );
  mkdirSync(join(paths.sourceSkills, "snippet"), { recursive: true });
  writeFileSync(
    join(paths.sourceSkills, "snippet", "SKILL.md"),
    "---\nname: snippet\ndescription: paste me\npaste: true\n---\n\nPaste this body.\n",
  );
  mkdirSync(paths.sourceCommands, { recursive: true });
  writeFileSync(
    join(paths.sourceCommands, "demo-cmd.md"),
    "---\ndescription: a demo command\n---\n\nDo it.\n",
  );
};

test("listSkills reports availability and the paste flag; --paste filters", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-inspect-"));
  seed(home);
  const paths = resolveSkillPaths(home);
  saveManifest(paths.manifestPath, setEnabled(defaultManifest(), "skills", "normal", false));

  const all = listSkills(paths, false);
  assert.deepEqual(
    all.map((s) => [s.name, s.availability, s.enabled, s.paste]),
    [
      ["normal", "disabled", false, false],
      ["snippet", "enabled", true, true],
    ],
  );
  assert.deepEqual(listSkills(paths, true).map((s) => s.name), ["snippet"]);
});

test("a disabled paste skill reports paste-only availability", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-inspect-"));
  seed(home);
  const paths = resolveSkillPaths(home);
  saveManifest(paths.manifestPath, setEnabled(defaultManifest(), "skills", "snippet", false));

  const snippet = listSkills(paths).find(skill => skill.name === "snippet");

  assert.equal(snippet?.availability, "paste-only");
});

test("skillContent returns body by default and the whole file with raw", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-inspect-"));
  seed(home);
  const paths = resolveSkillPaths(home);

  assert.equal(skillContent(paths, "snippet", false), "Paste this body.");
  assert.match(skillContent(paths, "snippet", true), /^---/);
  assert.throws(() => skillContent(paths, "missing", false));
});

test("listCommands reports command state and hosts", () => {
  const home = mkdtempSync(join(tmpdir(), "skctl-inspect-"));
  seed(home);
  const paths = resolveSkillPaths(home);

  const commands = listCommands(paths);
  assert.deepEqual(commands.map((c) => c.name), ["demo-cmd"]);
  assert.equal(commands[0].enabled, true);
  assert.deepEqual(commands[0].hosts, ["claude", "codex", "opencode", "cursor"]);
});
