import test from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";

test("parseFrontmatter tolerates missing, unterminated, BOM and CRLF frontmatter", () => {
  assert.deepEqual(parseFrontmatter("# plain\n\nbody"), {
    data: {},
    content: "# plain\n\nbody",
  });
  const unterminated = parseFrontmatter("---\nname: demo\nbody");
  assert.deepEqual(unterminated.data, {});
  assert.match(unterminated.content, /name: demo/);
  assert.equal(parseFrontmatter("﻿---\nname: demo\n---\nbody").data.name, "demo");
  assert.equal(parseFrontmatter("---\r\nname: demo\r\n---\r\nbody").data.name, "demo");
});

test("parseFrontmatter unfolds the block scalars older skctl versions wrote", () => {
  const { data } = parseFrontmatter(
    [
      "---",
      "description: >-",
      "  Dispatch coding work to worker agents",
      "  from a coordinating session.",
      "---",
      "body",
    ].join("\n"),
  );
  assert.equal(
    data.description,
    "Dispatch coding work to worker agents from a coordinating session.",
  );
});

test("parseFrontmatter throws on malformed frontmatter so callers can fall back", () => {
  assert.throws(() => parseFrontmatter("---\nname: demo\n  stray: 1\n---\nbody"), /YAMLParse/);
  assert.deepEqual(parseFrontmatter("---\njust a string\n---\nbody").data, {});
});

test("stringifyFrontmatter quotes what YAML requires and never folds long values", () => {
  const long = `Dispatch coding work to worker agents. ${"detail ".repeat(20)}`.trim();
  assert.equal(
    stringifyFrontmatter("body\n", {
      name: "demo",
      description: "Do X: then Y # note",
      plain: "greets someone",
      numeric: "2.0",
      lead: "- dash",
      long,
      paste: true,
      version: 2,
    }),
    [
      "---",
      "name: demo",
      'description: "Do X: then Y # note"',
      "plain: greets someone",
      'numeric: "2.0"',
      'lead: "- dash"',
      `long: ${long}`,
      "paste: true",
      "version: 2",
      "---",
      "body",
      "",
    ].join("\n"),
  );
});

test("stringifyFrontmatter drops undefined keys and empty data", () => {
  assert.equal(
    stringifyFrontmatter("body\n", { name: "demo", paste: undefined }),
    "---\nname: demo\n---\nbody\n",
  );
  assert.equal(stringifyFrontmatter("body\n", {}), "body\n");
});

test("frontmatter round-trips through stringify and parse", () => {
  const data = {
    name: "demo",
    description: "Colons: everywhere # and hashes, 'quotes' too",
    long: "a".repeat(200),
    metadata: { "argument-hint": "[a | b]", nested: { flag: true } },
    tools: ["Read", "Write"],
    multi: "first\nsecond",
    version: 3,
    paste: true,
  };
  assert.deepEqual(parseFrontmatter(stringifyFrontmatter("body\n", data)).data, data);
});
