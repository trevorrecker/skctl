import test from "node:test";
import assert from "node:assert/strict";
import {
  applyData,
  conflictCount,
  renderApply,
  renderRemoteAdded,
  renderStatus,
} from "./render.js";
import { setColor } from "./ui.js";
import type { ApplyResult } from "./render.js";
import type { DoctorReport } from "./skills/doctor.js";

setColor(false);

const result = (dryRun = false): ApplyResult => ({
  verb: "apply",
  dryRun,
  root: "/repo",
  hosts: ["claude", "codex"],
  sections: [
    {
      name: "skills",
      actions: [
        { kind: "ok", detail: "/links/one", subject: "one" },
        { kind: "removed", detail: "/links/two", subject: "two", note: "broken link" },
        { kind: "conflict", detail: "/links/three", subject: "three", note: "not a symlink" },
      ],
    },
    { name: "commands", actions: [] },
  ],
});

test("apply lists every section, logs only changes, and counts conflicts", () => {
  const text = renderApply(result());
  assert.match(text, /apply {2}\/repo → claude, codex/);
  assert.match(text, /skills {5}1 ok {3}1 removed {3}1 conflict/);
  assert.match(text, /commands {3}—/);
  assert.match(text, /- {2}skills {2}two {4}\/links\/two {4}broken link/);
  assert.doesNotMatch(text, /\/links\/one/);
  assert.match(text, /✖ 1 conflict · 1 change · 1 in sync/);
  assert.equal(conflictCount(result()), 1);
});

test("a clean apply collapses to a single summary line", () => {
  const clean: ApplyResult = {
    verb: "apply",
    dryRun: false,
    root: "/repo",
    hosts: ["claude"],
    sections: [{ name: "skills", actions: [{ kind: "ok", detail: "/links/one" }] }],
  };
  assert.match(renderApply(clean), /✔ nothing to do · 1 in sync/);
  assert.equal(conflictCount(clean), 0);
});

test("dry run marks the heading and the pending count", () => {
  const text = renderApply(result(true));
  assert.match(text, /apply {2}\(dry run\)/);
  assert.match(text, /1 change pending/);
});

test("quiet keeps conflicts and the summary only", () => {
  const text = renderApply(result(), { quiet: true });
  assert.doesNotMatch(text, /skills {3}1 ok/);
  assert.doesNotMatch(text, /broken link/);
  assert.match(text, /not a symlink/);
  assert.match(text, /✖ 1 conflict/);
});

test("notices lead the report and reach the json payload", () => {
  const text = renderApply(result(), { notices: ["enabled skill 'two'"] });
  assert.match(text, /enabled skill 'two'/);
  const data = applyData(result(), ["enabled skill 'two'"]);
  assert.deepEqual(data.notices, ["enabled skill 'two'"]);
  assert.deepEqual(data.summary, { inSync: 1, changed: 1, conflicts: 1 });
});

test("apply output removes terminal controls from action fields", () => {
  const unsafe: ApplyResult = {
    ...result(),
    sections: [
      {
        name: "remotes",
        actions: [
          {
            kind: "created",
            subject: "plugin\u001B]52;c;subject\u0007",
            detail: "cloned https://example.test/\u001B]52;c;detail\u0007",
            note: "selected\u001B]52;c;note\u0007",
          },
        ],
      },
    ],
  };

  const text = renderApply(unsafe);
  assert.doesNotMatch(text, /\u001B|\u0007/);
});

test("status separates issues from notes and names the totals", () => {
  const report: DoctorReport = {
    sourceSkillCount: 3,
    sourceCommandCount: 1,
    issues: [{ label: "broken link", detail: "/links/gone" }],
    notes: [{ label: "untracked", detail: "loose", hint: "run `skctl import`" }],
  };
  const text = renderStatus(report, "/repo");
  assert.match(text, /source {2}3 skills, 1 command/);
  assert.match(text, /✖ {2}broken link {2}\/links\/gone/);
  assert.match(text, /· {2}untracked {2}loose {2}run `skctl import`/);
  assert.match(text, /✖ 1 issue · 1 note/);
  assert.match(renderStatus({ ...report, issues: [] }, "/repo"), /✔ no issues/);
});

const fanOut = (): ApplyResult => ({
  verb: "apply",
  dryRun: false,
  root: "/repo",
  hosts: ["claude", "codex"],
  sections: [
    {
      name: "instructions",
      actions: [
        { kind: "ok", detail: "/home/.claude/AGENTS.md", subject: "AGENTS.md" },
        { kind: "ok", detail: "/home/.codex/AGENTS.md", subject: "AGENTS.md" },
        { kind: "ok", detail: "/home/.config/opencode/AGENTS.md", subject: "AGENTS.md" },
      ],
    },
    {
      name: "skills",
      actions: [
        { kind: "ok", detail: "/home/.agents/skills/alpha", subject: "alpha" },
        { kind: "ok", detail: "/home/.claude/skills/alpha", subject: "alpha" },
        { kind: "created", detail: "/home/.agents/skills/bro", subject: "bro" },
        { kind: "created", detail: "/home/.claude/skills/bro", subject: "bro" },
      ],
    },
  ],
});

test("counts name each kind of change without a link tally", () => {
  const text = renderApply(fanOut());
  assert.match(text, /instructions {3}1 ok/);
  assert.match(text, /skills {9}1 ok {3}1 created/);
  assert.match(text, /✔ 1 change · 2 in sync/);
  assert.doesNotMatch(text, /links/);
});

test("the change-log row names client directories, not the internal .build/ copies", () => {
  const withBuild: ApplyResult = {
    ...fanOut(),
    sections: [
      {
        name: "skills",
        actions: [
          { kind: "created", detail: "/repo/.build/claude/bro/SKILL.md", subject: "bro" },
          { kind: "created", detail: "/repo/.build/agents/bro/SKILL.md", subject: "bro" },
          { kind: "created", detail: "/home/.claude/skills/bro", subject: "bro" },
          { kind: "created", detail: "/home/.agents/skills/bro", subject: "bro" },
        ],
      },
    ],
  };
  const text = renderApply(withBuild);
  assert.match(text, /\+ {2}skills {2}bro {2}\/home\/\.claude\/skills, \/home\/\.agents\/skills/);
  assert.doesNotMatch(text, /\.build/);
});

test("one thing written to several places is a single change-log row", () => {
  const text = renderApply(fanOut());
  assert.match(text, /\+ {2}skills {2}bro {2}\/home\/\.agents\/skills, \/home\/\.claude\/skills/);
  assert.equal(text.split("\n").filter((line) => line.includes("bro")).length, 1);
});

test("a thing that half succeeded reports its worst kind and points at that place", () => {
  const mixed: ApplyResult = {
    verb: "apply",
    dryRun: false,
    root: "/repo",
    hosts: ["claude"],
    sections: [
      {
        name: "skills",
        actions: [
          { kind: "ok", detail: "/home/.agents/skills/bro", subject: "bro" },
          {
            kind: "conflict",
            detail: "/home/.claude/skills/bro",
            subject: "bro",
            note: "exists and is not a symlink",
          },
        ],
      },
    ],
  };
  const text = renderApply(mixed);
  assert.match(text, /skills {3}1 conflict/);
  assert.match(text, /! {2}skills {2}bro {2}\/home\/\.claude\/skills\/bro/);
  assert.doesNotMatch(text, /\.agents/);
  assert.equal(conflictCount(mixed), 1);
  assert.equal(applyData(mixed).summary.inSync, 0);
});

const notSelectedLine = (available: string[], selected: string[]): string =>
  renderRemoteAdded("matt", available, selected).find((line) =>
    line.includes("not selected"),
  ) ?? "";

test("a long unselected tail keeps the first four and tallies the rest", () => {
  const line = notSelectedLine(["a", "b", "c", "d", "e", "f", "g"], ["a"]);
  assert.equal(line, "not selected: b, c, d, e, and 2 more");
});

test("five or fewer unselected names stay listed in full", () => {
  const line = notSelectedLine(["a", "b", "c", "d", "e", "f"], ["a"]);
  assert.equal(line, "not selected: b, c, d, e, f");
});

test("dry run does not say nothing to do pending", () => {
  const clean: ApplyResult = { ...fanOut(), dryRun: true, sections: [] };
  assert.match(renderApply(clean), /nothing to do ·/);
  assert.doesNotMatch(renderApply(clean), /pending/);
});
