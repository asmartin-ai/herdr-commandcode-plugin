// Run with native Windows Node and Git Bash on the Windows CI runner.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

assert.equal(process.platform, "win32", "this test must run on Windows");
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), "herdr-windows-"));
const env = { ...process.env, USERPROFILE: temp, HOME: temp };
const installer = join(root, "cmd-hooks", "install-hooks.mjs");
const settingsPath = join(temp, ".commandcode", "settings.json");
const trustPath = join(temp, ".commandcode", "trusted-hooks.json");

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", env, ...options });
  assert.equal(result.status, 0, `${program}: ${result.error || result.stderr}`);
  return result.stdout;
}

try {
  run(process.execPath, [installer]);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const expected = `sh ${join(root, "cmd-hooks", "herdr-status.sh").replace(/\\/g, "/")}`;
  assert.match(expected, /^sh [A-Za-z]:\//);
  for (const event of ["SessionStart", "PreToolUse", "PostToolUse", "Stop"]) {
    assert.equal(settings.hooks[event][0].hooks[0].command, expected);
  }
  const trust = JSON.parse(readFileSync(trustPath, "utf8"));
  const fingerprint = createHash("sha256").update(expected).digest("hex").slice(0, 16);
  assert.ok(Object.values(trust).flat().some(entry => entry.fingerprint === fingerprint));
  run(process.execPath, [installer, "--uninstall"]);
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).hooks, {});
  assert.ok(!Object.values(JSON.parse(readFileSync(trustPath, "utf8"))).flat()
    .some(entry => entry.fingerprint === fingerprint));

  const bin = join(temp, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "cmdc"), '#!/bin/sh\nprintf "picked-cmdc:%s\\n" "$1"\n');
  const launchEnv = { ...env, PATH: `${bin}${delimiter}${env.PATH}`, HERDR_ENV: "" };
  delete launchEnv.COMMAND_CODE_BIN;
  const output = run("bash", [join(root, "scripts", "launch.sh"), "resume-last"], { env: launchEnv });
  assert.equal(output.trim(), "picked-cmdc:-c", "cmdc must be preferred over Windows cmd.exe");
  console.log("Windows hook paths, trust, uninstall, and command resolution passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
