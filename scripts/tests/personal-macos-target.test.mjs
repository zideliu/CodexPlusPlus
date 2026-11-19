import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../installer/macos/build-personal-target.sh", import.meta.url));

function runWithCargoStub(t, target) {
  const directory = mkdtempSync(join(tmpdir(), "personal-macos-target-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // Record each invocation and its arguments as separate lines.
  writeFileSync(join(directory, "cargo"), '#!/bin/sh\nprintf "%s\\n" cargo "$@"\n', { mode: 0o755 });
  return spawnSync("bash", [script, target], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, PATH: [directory, process.env.PATH].join(delimiter) },
  });
}

for (const target of ["aarch64-apple-darwin", "x86_64-apple-darwin"]) {
  test(`one release build produces the required targets for ${target}`, t => {
    const run = runWithCargoStub(t, target);
    assert.equal(run.status, 0, run.stderr);
    const expected = [
      "cargo", "build", "--locked", "--release", "--target", target,
      "--package", "codex-plus-manager", "--bin", "codex-plus-plus", "--bin", "codex-plus-legacy-shim",
    ];
    if (target === "aarch64-apple-darwin") expected.push("--package", "codex-plus-core", "--example", "personal-update-check");
    assert.deepEqual(run.stdout.trim().split("\n"), expected);
  });
}

test("an unknown target fails before starting Cargo", t => {
  const run = runWithCargoStub(t, "aarch64-unknown-linux-gnu");
  assert.equal(run.status, 2);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /Usage:/);
});
