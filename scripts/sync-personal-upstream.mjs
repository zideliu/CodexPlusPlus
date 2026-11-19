import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const upstreamUrl = "https://github.com/BigPizzaV3/CodexPlusPlus.git";
const renderer = "assets/inject/renderer-inject.js";
const manifest = "assets/inject/renderer-inject/manifest.json";
const protectedPaths = [
  ".github/workflows/",
  ".github/actions/personal-candidate/",
  "scripts/installer/macos/build-personal-target.sh",
  "scripts/tests/personal-macos-target.test.mjs",
  "scripts/sync-personal-upstream.mjs",
  "scripts/personal-release.mjs",
  "scripts/tests/personal-automation.test.mjs",
  "apps/codex-plus-manager/src/personal-no-ads.test.ts",
  "crates/codex-plus-core/src/update.rs",
  "crates/codex-plus-core/src/update/",
  "crates/codex-plus-core/src/version.rs",
  "crates/codex-plus-core/tests/all/updater.rs",
  "crates/codex-plus-core/examples/personal-update-check.rs",
];

export function mergeUpstream(root, upstreamRef) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (git("status", "--porcelain")) throw new Error("Refusing to merge into a dirty checkout");
  const base = git("rev-parse", "HEAD");
  const upstream = git("rev-parse", "--verify", `${upstreamRef}^{commit}`);
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", upstream, base], { cwd: root });
  if (ancestor.status === 0) return { base, upstream, sha: base, changed: false };
  if (ancestor.status !== 1) throw new Error("Cannot compare upstream ancestry");

  const merged = spawnSync("git", ["merge", "--no-ff", "--no-commit", upstream], { cwd: root, encoding: "utf8" });
  const conflicts = git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
  const sourceConflicts = conflicts.filter(file => ![renderer, manifest].includes(file));
  if (sourceConflicts.length) throw new Error(`Source merge conflict; manual resolution required: ${sourceConflicts.join(", ")}`);
  if (merged.status !== 0 && !conflicts.length) throw new Error(`Merge failed: ${merged.stderr}`);

  // Only discard generated line counts, never changes to fragment names/order/metadata.
  if (conflicts.includes(manifest)) {
    const stage = n => JSON.parse(git("show", `:${n}:${manifest}`));
    const withoutCounts = value => ({ ...value, fragments: value.fragments.map(({ lines, ...rest }) => rest) });
    if (JSON.stringify(withoutCounts(stage(1))) !== JSON.stringify(withoutCounts(stage(2)))) {
      throw new Error("Personal manifest metadata changed; manual merge required");
    }
    writeFileSync(path.join(root, manifest), `${JSON.stringify(stage(3), null, 2)}\n`);
  }
  // Source fragments are authoritative; regeneration also resolves the monolithic artifact.
  execFileSync(process.execPath, ["scripts/assemble-renderer-inject.mjs"], { cwd: root, stdio: "inherit" });
  git("add", renderer, manifest);
  if (git("diff", "--name-only", "--diff-filter=U")) throw new Error("Unresolved merge conflict");
  const changed = git("diff", "--cached", "--name-only", base).split("\n");
  const protectedChanges = changed.filter(file => protectedPaths.some(p => p.endsWith("/") ? file.startsWith(p) : file === p));
  if (protectedChanges.length) throw new Error(`Automation/guard changes require manual review: ${protectedChanges.join(", ")}`);
  git("diff", "--cached", "--check");
  git("-c", "core.hooksPath=/dev/null", "commit", "-m", `Merge upstream ${upstream.slice(0, 12)} into personal macOS build`);
  return { base, upstream, sha: git("rev-parse", "HEAD"), changed: true };
}

export function syncPersonal(root, force = false) {
  execFileSync("git", ["fetch", "--no-tags", upstreamUrl, "main"], { cwd: root, stdio: "inherit" });
  const result = mergeUpstream(root, "FETCH_HEAD");
  const { version } = JSON.parse(readFileSync(path.join(root, "apps/codex-plus-manager/package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Invalid package version");
  const outputs = { ...result, version, should_build: force || result.changed };
  if (process.env.GITHUB_OUTPUT) {
    for (const [key, value] of Object.entries(outputs)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Upstream sync\n\nUpstream: ${result.upstream}\n\nCandidate: ${result.sha}\n\n${outputs.should_build ? "Build and tests required before push/publication." : "No upstream changes; no build or Release needed."}\n`);
  return outputs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(syncPersonal(process.cwd(), process.argv.includes("--force-build"))));
  } catch (error) {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Sync stopped\n\nNo branch was pushed and no Release was created.\n\n${error.message}\n`);
    console.error(error.message);
    process.exitCode = 1;
  }
}
