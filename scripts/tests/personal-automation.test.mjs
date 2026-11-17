import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mergeUpstream } from "../sync-personal-upstream.mjs";
import { releaseIdentity, verifyAssets, latestManifest, resolveUpstreamNotes, personalReleaseNotes } from "../personal-release.mjs";

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
  const manifest = latestManifest("2.7.1", "4", "a".repeat(40), root, "test notes");
  assert.equal(manifest.version, "2.7.1-noads.4");
  assert.equal(manifest.assets[0].sha256, hash);
  assert.equal(manifest.assets[0].size, content.length);
  assert.equal(manifest.assets[0].url, `https://github.com/zideliu/CodexPlusPlus/releases/download/v2.7.1-noads.4/${filename}`);
  assert.equal(manifest.url, "https://github.com/zideliu/CodexPlusPlus/releases/tag/v2.7.1-noads.4");
  assert.equal(manifest.body, "test notes");
  assert.equal(manifest.source_commit, "a".repeat(40));
  writeFileSync(path.join(root, filename), "corrupt");
  assert.throws(() => verifyAssets(root, filename), /checksum/);
  writeFileSync(path.join(root, "unexpected.txt"), "extra");
  assert.throws(() => verifyAssets(root, filename), /Unexpected/);
});

test("upstream updater changes require manual review before publication", () => {
  const f = fixture();
  f.upstream({ "crates/codex-plus-core/src/update.rs": "new updater code\n" });
  assert.throws(() => mergeUpstream(f.root, "upstream"), /manual review/);
});

test("upstream notes request the exact built version, never releases/latest", () => {
  const notes = resolveUpstreamNotes("2.7.1", "a".repeat(40), {
    gh: (...args) => {
      assert.deepEqual(args, ["api", "repos/BigPizzaV3/CodexPlusPlus/releases/tags/v2.7.1"]);
      return JSON.stringify({ tag_name: "v2.7.1", body: "### Fixes\n\nA fix.\n", draft: false, html_url: "https://untrusted.example" });
    },
    git: () => { throw new Error("Changelog should not be read for usable release notes"); },
  });
  assert.equal(notes.body, "### Fixes\n\nA fix.");
  assert.equal(notes.url, "https://github.com/BigPizzaV3/CodexPlusPlus/releases/tag/v2.7.1");
  assert.equal(notes.source, "Release");
});

for (const result of [null, { tag_name: "v2.7.1", body: " " }, { tag_name: "v9.9.9", body: "Wrong version" }, { tag_name: "v2.7.1", body: "Draft", draft: true }]) {
  test(`missing/unusable upstream notes fall back to pinned matching changelog: ${JSON.stringify(result)}`, () => {
    const upstream = "b".repeat(40);
    const notes = resolveUpstreamNotes("2.7.1", upstream, {
      gh: () => { if (!result) throw new Error("HTTP 404"); return JSON.stringify(result); },
      git: (...args) => {
        assert.deepEqual(args, ["show", `${upstream}:CHANGELOG.md`]);
        return "# Changelog\n\n## 2.8.0 - later\nWrong version\n\n## 2.7.1 - today\nCorrect section\n\n## 2.7.0 - before\nOld section\n";
      },
      warn: () => {},
    });
    assert.equal(notes.body, "Correct section");
    assert.equal(notes.source, "CHANGELOG.md");
    assert.ok(notes.url.includes(`/blob/${upstream}/CHANGELOG.md`));
  });
}

test("missing notes in both sources fail instead of substituting unrelated versions", () => {
  assert.throws(() => resolveUpstreamNotes("2.7.1", "a".repeat(40), {
    gh: () => { throw new Error("offline"); },
    git: () => "## 2.8.0\nNot built\n",
    warn: () => {},
  }), /No release notes or pinned changelog section/);
  assert.throws(() => resolveUpstreamNotes("2.7.1/../../latest", "a".repeat(40), {
    gh: () => { assert.fail("Must validate before network access"); }, git: () => "",
  }), /Invalid version/);
});

test("personal wrapper preserves attribution and shares exact body with latest.json", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "personal-notes-"));
  const sha = "a".repeat(40);
  const filename = releaseIdentity("2.7.1", 6, sha).filename;
  const hash = createHash("sha256").update("DMG").digest("hex");
  writeFileSync(path.join(dir, filename), "DMG");
  writeFileSync(path.join(dir, "SHA256SUMS.txt"), `${hash}  ${filename}\n`);
  const upstreamBody = "### 修复\n\n- 保留原版更新条目。\n- `$(echo not-executed)`";
  const body = personalReleaseNotes({ version: "2.7.1", runNumber: 6, sha, upstream: "b".repeat(40), runId: 123 }, {
    body: upstreamBody, source: "Release", url: "https://github.com/BigPizzaV3/CodexPlusPlus/releases/tag/v2.7.1",
  });
  assert.ok(body.includes(upstreamBody));
  assert.match(body, /非官方自用构建/);
  assert.match(body, /AGPL-3.0-only/);
  assert.match(body, /未经 Apple 公证/);
  const plain = latestManifest("2.7.1", 6, sha, dir);
  const withNotes = latestManifest("2.7.1", 6, sha, dir, body);
  assert.equal(withNotes.body, body);
  assert.deepEqual({ ...withNotes, body: "" }, plain);
  assert.equal(withNotes.assets[0].url, `https://github.com/zideliu/CodexPlusPlus/releases/download/v2.7.1-noads.6/${filename}`);
});
