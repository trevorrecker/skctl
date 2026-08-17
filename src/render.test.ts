import test from "node:test";
import assert from "node:assert/strict";
import { applyData, conflictCount, renderApply, renderStatus } from "./render.js";
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
