import test from "node:test";
import assert from "node:assert/strict";
import { renderLaunchAgent } from "./schedule.js";

test("renderLaunchAgent runs refresh with the configured root and interval", () => {
  const plist = renderLaunchAgent({
    nodePath: "/opt/node/bin/node",
    cliPath: "/opt/skctl/dist/cli.js",
    root: "/Users/test/dev/skills & tools",
    logPath: "/Users/test/.config/skctl/refresh.log",
    intervalHours: 6,
    environment: {
      HOME: "/Users/test",
      CODEX_HOME: "/Users/test/.codex-alt",
    },
  });

  assert.match(plist, /<integer>21600<\/integer>/);
  assert.match(plist, /<string>refresh<\/string>/);
  assert.match(plist, /<string>--root<\/string>/);
  assert.match(plist, /<string>--quiet<\/string>/);
  assert.match(plist, /<string>--no-color<\/string>/);
  assert.match(plist, /skills &amp; tools/);
  assert.match(plist, /CODEX_HOME/);
});
