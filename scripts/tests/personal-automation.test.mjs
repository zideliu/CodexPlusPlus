import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mergeUpstream } from "../sync-personal-upstream.mjs";
import { releaseIdentity, verifyAssets } from "../personal-release.mjs";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "personal-sync-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (file, content) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), content); };
  const commit = message => { git("add", "."); git("commit", "-m", message); return git("rev-parse", "HEAD"); };
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  write("source.txt", "upstream base\n");
  write("ads.txt", "ads enabled\n");
  write("scripts/assemble-renderer-inject.mjs", `import {readFileSync,writeFileSync} from 'node:fs';
    const p='assets/inject/renderer-inject/manifest.json'; const m=JSON.parse(readFileSync(p));
    m.fragments.forEach(f=>f.lines=10); writeFileSync(p,JSON.stringify(m)+'\\n');
    writeFileSync('assets/inject/renderer-inject.js', 'generated\\n');`);
  write("assets/inject/renderer-inject.js", "generated\n");
  write("assets/inject/renderer-inject/manifest.json", '{"fragments":[{"name":"00.js","lines":1}]}\n');
  write(".github/workflows/build.yml", "original\n");
  commit("base");
  git("branch", "upstream");
  write("ads.txt", "ads disabled\n");
  commit("personal no ads");
  const upstream = edits => {
    git("switch", "upstream");
    for (const [file, content] of Object.entries(edits)) write(file, content);
    commit("upstream change");
    git("switch", "main");
  };
  return { root, git, write, upstream, commit };
}

test("merge preserves personal edits and retains both parents", () => {
  const f = fixture();
  f.upstream({ "source.txt": "new feature\n" });
  const result = mergeUpstream(f.root, "upstream");
  assert.equal(result.changed, true);
  assert.equal(readFileSync(path.join(f.root, "ads.txt"), "utf8"), "ads disabled\n");
  assert.equal(f.git("show", "HEAD:source.txt"), "new feature");
  assert.equal(f.git("show", "-s", "--format=%P", "HEAD").split(" ").length, 2);
  assert.equal(mergeUpstream(f.root, "upstream").changed, false);
});

test("source conflicts fail without moving personal branch", () => {
  const f = fixture();
  f.upstream({ "ads.txt": "new advertisement\n" });
  const before = f.git("rev-parse", "HEAD");
  assert.throws(() => mergeUpstream(f.root, "upstream"), /Source merge conflict/);
  assert.equal(f.git("rev-parse", "HEAD"), before);
});

test("upstream cannot silently change automation", () => {
  const f = fixture();
  f.upstream({ ".github/workflows/build.yml": "changed permissions\n" });
  const before = f.git("rev-parse", "HEAD");
  assert.throws(() => mergeUpstream(f.root, "upstream"), /manual review/);
  assert.equal(f.git("rev-parse", "HEAD"), before);
});

test("dirty checkout cannot be merged", () => {
  const f = fixture();
  f.write("ads.txt", "unsaved\n");
  assert.throws(() => mergeUpstream(f.root, "upstream"), /dirty checkout/);
});

test("generated artifact and count-only manifest conflicts are regenerated", () => {
  const f = fixture();
  const manifest = "assets/inject/renderer-inject/manifest.json";
  f.write(manifest, '{"fragments":[{"name":"00.js","lines":2}]}\n');
  f.write("assets/inject/renderer-inject.js", "personal generated\n");
  f.commit("personal generated output");
  f.upstream({ [manifest]: '{"fragments":[{"name":"00.js","lines":3}]}\n', "assets/inject/renderer-inject.js": "upstream generated\n" });
  assert.equal(mergeUpstream(f.root, "upstream").changed, true);
  assert.equal(f.git("show", "HEAD:assets/inject/renderer-inject.js"), "generated");
  assert.equal(JSON.parse(f.git(`show`, `HEAD:${manifest}`)).fragments[0].lines, 10);
});

test("manifest metadata conflicts are not silently discarded", () => {
  const f = fixture();
  const manifest = "assets/inject/renderer-inject/manifest.json";
  f.write(manifest, '{"fragments":[{"name":"personal.js","lines":2}]}\n');
  f.commit("personal fragment");
  f.upstream({ [manifest]: '{"fragments":[{"name":"upstream.js","lines":3}]}\n' });
  assert.throws(() => mergeUpstream(f.root, "upstream"), /metadata changed/);
});

test("candidate bundle transfers the exact tested commit, including a no-change run", () => {
  for (const withMerge of [false, true]) {
    const f = fixture();
    const base = f.git("rev-parse", "HEAD");
    const publisher = mkdtempSync(path.join(os.tmpdir(), "personal-publisher-"));
    execFileSync("git", ["clone", "--quiet", f.root, publisher]);
    if (withMerge) f.upstream({ "source.txt": "new feature\n" });
    const result = mergeUpstream(f.root, "upstream");
    const bundle = path.join(os.tmpdir(), `candidate-${path.basename(f.root)}.bundle`);
    f.git("bundle", "create", bundle, "HEAD", `^${base}^`);
    execFileSync("git", ["fetch", bundle, "HEAD"], { cwd: publisher, stdio: "pipe" });
    assert.equal(execFileSync("git", ["rev-parse", "FETCH_HEAD"], { cwd: publisher, encoding: "utf8" }).trim(), result.sha);
  }
});

test("release identity uses validated version/run/commit, not branch names", () => {
  assert.deepEqual(releaseIdentity("2.7.1", "4", "a".repeat(40)), {
    buildVersion: "2.7.1-noads.4", tag: "v2.7.1-noads.4", filename: "CodexPlusPlus-2.7.1-noads.4-macos-universal.dmg",
  });
  for (const version of ["../../bad", "$(bad)", "v2.7.1"]) assert.throws(() => releaseIdentity(version, "4", "a".repeat(40)));
  assert.throws(() => releaseIdentity("2.7.1", "4;bad", "a".repeat(40)));
});

test("publication requires exactly the DMG and its valid checksum", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "personal-assets-"));
  const filename = "CodexPlusPlus-2.7.1-noads.4-macos-universal.dmg";
  const content = Buffer.from("fixture DMG");
  const hash = createHash("sha256").update(content).digest("hex");
  writeFileSync(path.join(root, filename), content);
  writeFileSync(path.join(root, "SHA256SUMS.txt"), `${hash}  ./${filename}\n`);
  assert.equal(verifyAssets(root, filename).length, 2);
  writeFileSync(path.join(root, filename), "corrupt");
  assert.throws(() => verifyAssets(root, filename), /checksum/);
  writeFileSync(path.join(root, "unexpected.txt"), "extra");
  assert.throws(() => verifyAssets(root, filename), /Unexpected/);
});
