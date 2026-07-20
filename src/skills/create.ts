import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import type { SkillPaths } from "./paths.js";

export interface SkillFields {
  name: string;
  description?: string;
  paste?: boolean;
  body?: string;
}

export interface CommandFields {
  name: string;
  description?: string;
  argumentHint?: string;
  body?: string;
}

const namePattern = /^[a-z0-9][a-z0-9-]*$/;

export const validateName = (name: string): void => {
  if (!namePattern.test(name)) {
    throw new Error(`invalid name '${name}' — use kebab-case (a-z, 0-9, -), no leading dash`);
  }
};

const skillDescriptionPlaceholder =
  "TODO one sentence on what this does, then the phrases a user types to trigger it";

const commandDescriptionPlaceholder = "TODO one sentence on what this command does";

const skillBodyPlaceholder = (name: string): string =>
  [
    `# ${name}`,
    "",
    "TODO one line on what this skill does and when to reach for it.",
    "",
    "## Process",
    "",
    "1. TODO first step.",
    "",
    "## What this skill never does",
    "",
    "- TODO the anti-scope.",
  ].join("\n");

const commandBodyPlaceholder = (name: string): string =>
  `TODO what /${name} does with $ARGUMENTS.`;

const parseBody = (
  body: string | undefined,
): { data: Record<string, unknown>; content: string } => {
  if (body === undefined) return { data: {}, content: "" };
  const parsed = matter(body);
  const data =
    parsed.data && typeof parsed.data === "object"
      ? (parsed.data as Record<string, unknown>)
      : {};
  return { data, content: parsed.content };
};

export const renderSkill = (fields: SkillFields): string => {
  const { data, content } = parseBody(fields.body);
  data.name = fields.name;
  if (fields.description !== undefined) data.description = fields.description;
  else if (typeof data.description !== "string") data.description = skillDescriptionPlaceholder;
  if (fields.paste) data.paste = true;
  else delete data.paste;
  const body = content.trim() || skillBodyPlaceholder(fields.name);
  return matter.stringify(`\n${body}\n`, data);
};

export const renderCommand = (fields: CommandFields): string => {
  const { data, content } = parseBody(fields.body);
  delete data.name;
  if (fields.description !== undefined) data.description = fields.description;
  else if (typeof data.description !== "string") data.description = commandDescriptionPlaceholder;
  if (fields.argumentHint !== undefined) data.argumentHint = fields.argumentHint;
  const body = content.trim() || commandBodyPlaceholder(fields.name);
  return matter.stringify(`\n${body}\n`, data);
};

const write = (dest: string, content: string, force: boolean, label: string): string => {
  if (existsSync(dest) && !force) {
    throw new Error(`${label} already exists at ${dest} (use --force to overwrite)`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content, "utf-8");
  return dest;
};

export const createSkill = (
  paths: SkillPaths,
  fields: SkillFields,
  force: boolean,
): string => {
  validateName(fields.name);
  const dest = join(paths.sourceSkills, fields.name, "SKILL.md");
  return write(dest, renderSkill(fields), force, `skill '${fields.name}'`);
};

export const createCommand = (
  paths: SkillPaths,
  fields: CommandFields,
  force: boolean,
): string => {
  validateName(fields.name);
  const dest = join(paths.sourceCommands, `${fields.name}.md`);
  return write(dest, renderCommand(fields), force, `command '${fields.name}'`);
};
