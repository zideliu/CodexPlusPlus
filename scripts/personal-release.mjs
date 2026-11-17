import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function releaseIdentity(version, runNumber, sha) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Invalid version");
  if (!/^[1-9]\d*$/.test(String(runNumber))) throw new Error("Invalid run number");
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid commit SHA");
  const buildVersion = `${version}-noads.${runNumber}`;
  return { buildVersion, tag: `v${buildVersion}`, filename: `CodexPlusPlus-${buildVersion}-macos-universal.dmg` };
}

export function verifyAssets(directory, filename) {
  const names = readdirSync(directory).sort();
  if (JSON.stringify(names) !== JSON.stringify([filename, "SHA256SUMS.txt"].sort())) throw new Error("Unexpected release assets");
  const data = readFileSync(path.join(directory, filename));
  if (!data.length) throw new Error("Empty DMG");
  const hash = createHash("sha256").update(data).digest("hex");
  const checksum = readFileSync(path.join(directory, "SHA256SUMS.txt"), "utf8").trim();
  if (checksum !== `${hash}  ./${filename}` && checksum !== `${hash}  ${filename}`) throw new Error("DMG checksum mismatch");
  return [path.join(directory, filename), path.join(directory, "SHA256SUMS.txt")];
}

export function latestManifest(version, runNumber, sha, directory, body = "") {
  const { buildVersion, tag, filename } = releaseIdentity(version, runNumber, sha);
  verifyAssets(directory, filename);
  const data = readFileSync(path.join(directory, filename));
  const repo = "zideliu/CodexPlusPlus";
  return {
    version: buildVersion,
    tag_name: tag,
    url: `https://github.com/${repo}/releases/tag/${tag}`,
    body,
    source_commit: sha,
    assets: [{
      name: filename,
      url: `https://github.com/${repo}/releases/download/${tag}/${filename}`,
      sha256: createHash("sha256").update(data).digest("hex"),
      size: data.length,
    }],
  };
}

export function publishPersonal(root, artifactDir, bundle, env = process.env) {
  const { GITHUB_REPOSITORY: repo, CANDIDATE_SHA: sha, BASE_SHA: base, UPSTREAM_SHA: upstream,
    BUILD_VERSION: version, GITHUB_RUN_NUMBER: runNumber, GITHUB_RUN_ID: runId } = env;
  if (repo !== "zideliu/CodexPlusPlus") throw new Error("Unexpected publication repository");
  if (![base, upstream].every(s => /^[a-f0-9]{40}$/.test(s || ""))) throw new Error("Invalid source commits");
  const { tag, filename } = releaseIdentity(version, runNumber, sha);
  const assets = verifyAssets(artifactDir, filename);
  const metadata = path.join(env.RUNNER_TEMP || root, "latest.json");
  const manifest = latestManifest(version, runNumber, sha, artifactDir,
    `Codex++ ${version}-noads.${runNumber}: personal no-ads macOS build. Updates remain on zideliu/CodexPlusPlus. Ad-hoc signed, not Apple-notarized.`);
  writeFileSync(metadata, `${JSON.stringify(manifest, null, 2)}\n`);
  assets.push(metadata);
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, env, encoding: "utf8" }).trim();
  const git = (...args) => run("git", args);
  const gh = (...args) => run("gh", args);
  git("fetch", bundle, "HEAD");
  if (git("rev-parse", "FETCH_HEAD") !== sha) throw new Error("Bundle does not match tested commit");
  git("merge-base", "--is-ancestor", base, sha);
  git("merge-base", "--is-ancestor", upstream, sha);
  const remote = gh("api", `repos/${repo}/git/ref/heads/personal-macos`, "--jq", ".object.sha");
  if (remote !== base && remote !== sha) throw new Error("personal-macos moved during build; rerun against the new branch head");
  const releases = JSON.parse(gh("api", "--paginate", `repos/${repo}/releases?per_page=100`, "--slurp")).flat();
  const existing = releases.find(release => release.tag_name === tag);
  if (existing && existing.target_commitish !== sha) throw new Error("Release tag already belongs to another commit");
  if (existing && !existing.draft) {
    if (!assets.every(file => existing.assets.some(asset => asset.name === path.basename(file) && asset.size > 0))) throw new Error("Published Release is incomplete; refusing to overwrite it");
    return existing.html_url;
  }
  const tags = git("ls-remote", "--tags", `https://github.com/${repo}.git`, `refs/tags/${tag}`);
  if (tags && tags.split(/\s/)[0] !== sha) throw new Error("Existing tag points to a different commit");
  // Normal atomic push: concurrent branch updates cannot be overwritten.
  git("-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "push", "--atomic",
    `https://github.com/${repo}.git`, `${sha}:refs/heads/personal-macos`, `${sha}:refs/tags/${tag}`);
  const notes = path.join(env.RUNNER_TEMP || root, "personal-release-notes.md");
  writeFileSync(notes, `## Codex++ ${version} - macOS No Ads\n\n` +
    `Unofficial personal build; retains the AGPL-3.0-only license and original attribution.\n\n` +
    `- Upstream commit: https://github.com/BigPizzaV3/CodexPlusPlus/commit/${upstream}\n` +
    `- Tested source: https://github.com/${repo}/commit/${sha}\n` +
    `- Build: https://github.com/${repo}/actions/runs/${runId}\n` +
    `- Includes removal of sponsor UI and advertisement network requests.\n` +
    `- Universal DMG: Apple Silicon and Intel; ad-hoc signed, not Apple-notarized.\n\n` +
    `- In-app updates use this fork's latest.json and compare numeric noads build numbers.\n` +
    `- Existing builds through noads.4 still use the original update source: install this DMG manually once to switch channels.\n\n` +
    `Download the DMG and SHA256SUMS.txt to the same directory, then run \`shasum -a 256 -c SHA256SUMS.txt\`.\n\n` +
    `macOS may require approval in Privacy & Security. Do not disable Gatekeeper globally.\n`);
  if (!existing) gh("release", "create", tag, "--repo", repo, "--verify-tag", "--target", sha,
    "--draft", "--title", `Codex++ ${version} No Ads (macOS) - build ${runNumber}`, "--notes-file", notes);
  gh("release", "upload", tag, ...assets, "--repo", repo, "--clobber");
  const uploaded = JSON.parse(gh("release", "view", tag, "--repo", repo, "--json", "assets"));
  if (!assets.every(file => uploaded.assets.some(asset => asset.name === path.basename(file) && asset.size === readFileSync(file).length))) throw new Error("Release asset upload verification failed");
  gh("release", "edit", tag, "--repo", repo, "--draft=false", "--latest", "--notes-file", notes);
  const url = gh("release", "view", tag, "--repo", repo, "--json", "url", "--jq", ".url");
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `## Release published\n\n[Download DMG and checksums](${url})\n\nSource: ${sha}\n`);
  return url;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(publishPersonal(process.cwd(), path.resolve(process.argv[2]), path.resolve(process.argv[3])));
}
