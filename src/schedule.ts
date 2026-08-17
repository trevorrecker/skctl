import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type LaunchAgentSpec = {
  nodePath: string;
  cliPath: string;
  root: string;
  logPath: string;
  intervalHours: number;
  environment: Record<string, string>;
};

export type ScheduleStatus = {
  path: string;
  installed: boolean;
  loaded: boolean;
};

const launchAgentLabel = "dev.skctl.refresh";
const launchctl = "/bin/launchctl";

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const stringElement = (value: string): string =>
  `    <string>${escapeXml(value)}</string>`;

export const launchAgentPath = (home = homedir()): string =>
  join(home, "Library", "LaunchAgents", `${launchAgentLabel}.plist`);

const launchDomain = (): string => {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("cannot determine the current user id");
  return `gui/${uid}`;
};

export const renderLaunchAgent = (spec: LaunchAgentSpec): string => {
  const seconds = Math.max(60, Math.round(spec.intervalHours * 60 * 60));
  const environment = Object.entries(spec.environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => [
      `      <key>${escapeXml(key)}</key>`,
      `      <string>${escapeXml(value)}</string>`,
    ])
    .join("\n");
  const argumentsXml = [
    spec.nodePath,
    spec.cliPath,
    "refresh",
    "--root",
    spec.root,
    "--no-raycast",
    "--quiet",
    "--no-color",
  ].map(stringElement).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${launchAgentLabel}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(spec.root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${environment}
  </dict>
  <key>StartInterval</key>
  <integer>${seconds}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(spec.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(spec.logPath)}</string>
</dict>
</plist>
`;
};

const requireMacOs = (): void => {
  if (process.platform !== "darwin") {
    throw new Error(
      "schedule installation is supported on macOS; run `skctl refresh` from the system scheduler",
    );
  }
};

export const getScheduleStatus = (home = homedir()): ScheduleStatus => {
  requireMacOs();
  const path = launchAgentPath(home);
  const loaded = spawnSync(launchctl, ["print", `${launchDomain()}/${launchAgentLabel}`], {
    stdio: "ignore",
  }).status === 0;
  return { path, installed: existsSync(path), loaded };
};

export const installSchedule = (
  spec: LaunchAgentSpec,
  home = homedir(),
): ScheduleStatus => {
  requireMacOs();
  const path = launchAgentPath(home);
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(dirname(spec.logPath), { recursive: true });
  writeFileSync(path, renderLaunchAgent(spec), "utf-8");
  const domain = launchDomain();
  spawnSync(launchctl, ["bootout", domain, path], { stdio: "ignore" });
  execFileSync(launchctl, ["bootstrap", domain, path], { stdio: "ignore" });
  return getScheduleStatus(home);
};

export const removeSchedule = (home = homedir()): ScheduleStatus => {
  requireMacOs();
  const path = launchAgentPath(home);
  spawnSync(launchctl, ["bootout", launchDomain(), path], { stdio: "ignore" });
  if (existsSync(path)) rmSync(path);
  return getScheduleStatus(home);
};
