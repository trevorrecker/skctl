import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  columns,
  dim,
  dropEmptyColumns,
  keyValues,
  report,
  setColor,
  shortPath,
  shorten,
  width,
} from "./ui.js";

test("styles wrap text only while color is on", () => {
  setColor(true);
  assert.equal(dim("hi"), "\u001B[2mhi\u001B[22m");
  assert.equal(dim(""), "");
  setColor(false);
  assert.equal(dim("hi"), "hi");
});

test("width ignores ANSI sequences", () => {
  setColor(true);
  assert.equal(width(dim("abcd")), 4);
  setColor(false);
});

test("columns align on visible width and cap runaway cells", () => {
  setColor(true);
  const aligned = columns([
    [dim("a"), "one"],
    ["bbbb", "two"],
  ]);
  assert.deepEqual(aligned, [`${dim("a")}     one`, "bbbb  two"]);
  setColor(false);

  const long = "x".repeat(80);
  const capped = columns([[long, "note"], ["short", "note"]]);
  assert.equal(capped[0], `${long}  note`);
  assert.equal(capped[1], `${"short".padEnd(52)}  note`);
});

test("columns leave the last cell unpadded", () => {
  assert.deepEqual(columns([["a", "long value"], ["bb", "x"]]), ["a   long value", "bb  x"]);
});

test("dropEmptyColumns removes columns that are blank everywhere", () => {
  assert.deepEqual(
    dropEmptyColumns([
      ["a", "", "c"],
      ["d", "", "f"],
    ]),
    [
      ["a", "c"],
      ["d", "f"],
    ],
  );
});

test("paths shorten to a tilde inside home", () => {
  const inside = join(homedir(), "agent-skills");
  assert.equal(shortPath(inside), "~/agent-skills");
  assert.equal(shortPath(homedir()), "~");
  assert.equal(shortPath("/opt/tools"), "/opt/tools");
  assert.equal(shorten(`linked ${inside} ok`), "linked ~/agent-skills ok");
});

test("report indents its groups and separates them with blank lines", () => {
  assert.equal(report(["one"], ["two"]), "\n  one\n\n  two\n");
  assert.equal(report([], ["only"]), "\n  only\n");
  assert.equal(report([]), "");
});

test("keyValues repeats the key column only on the first row", () => {
  setColor(false);
  assert.deepEqual(keyValues([["targets", ["a", "b"]], ["mode", "fast"]]), [
    "targets  a",
    "         b",
    "mode     fast",
  ]);
});
