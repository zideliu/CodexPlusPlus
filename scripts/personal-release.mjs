import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changelogSection } from "./release-meta.mjs";

const personalRepository = "zideliu/CodexPlusPlus";
const upstreamRepository = "BigPizzaV3/CodexPlusPlus";

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

export function resolveUpstreamNotes(version, upstream, { git, gh, warn = console.warn }) {
  // Validate before using either value in a URL or a git revision expression.
  releaseIdentity(version, "1", upstream);
  const tag = `v${version}`;
  try {
    const release = JSON.parse(gh("api", `repos/${upstreamRepository}/releases/tags/${tag}`));
    if (release.tag_name === tag && !release.draft && typeof release.body === "string" && release.body.trim()) {
      return {
        body: release.body.trim(),
        url: `https://github.com/${upstreamRepository}/releases/tag/${tag}`,
        source: "Release",
      };
    }
    warn(`No usable upstream notes for ${tag}; using the pinned changelog.`);
  } catch {
    warn(`Could not read upstream ${tag}; using the pinned changelog.`);
  }
  const body = changelogSection(version, git("show", `${upstream}:CHANGELOG.md`));
  if (!body) throw new Error(`No release notes or pinned changelog section for ${version}`);
  return {
    body,
    url: `https://github.com/${upstreamRepository}/blob/${upstream}/CHANGELOG.md`,
    source: "CHANGELOG.md",
  };
}

export function personalReleaseNotes({ version, runNumber, sha, upstream, runId }, upstreamNotes) {
  const { buildVersion } = releaseIdentity(version, runNumber, sha);
  if (!/^[a-f0-9]{40}$/.test(upstream) || !/^[1-9]\d*$/.test(String(runId))) throw new Error("Invalid release provenance");
  if (!upstreamNotes.body?.trim()) throw new Error("Empty upstream release notes");
  return `## Codex++ ${buildVersion} · macOS 无广告自用版\n\n` +
    `本版本是 [${upstreamRepository}](https://github.com/${upstreamRepository}) 的非官方自用构建，保留原作者署名、AGPL-3.0-only 许可证及第三方声明。\n\n` +
    `### 自用版说明\n\n` +
    `- 基于上游 **${version}**，移除赞助商展示和广告网络请求。\n` +
    `- 软件内更新源固定为 **${personalRepository}**，保留 noads 构建号比较和 SHA256 校验。\n` +
    `- 支持 Apple Silicon 和 Intel；使用 ad-hoc 签名，**未经 Apple 公证**。上游说明中涉及其他平台、签名或分发的内容不代表本构建。\n` +
    `- 已安装 noads.4 或更早版本时，需要手动安装新版 DMG 一次，才能切换到自用更新源。\n\n` +
    `### 上游 ${version} 更新说明\n\n` +
    `来源：[原仓库 ${upstreamNotes.source}](${upstreamNotes.url})。以下正文来自该版本，不代表额外功能已在本机逐项验证。\n\n` +
    `${upstreamNotes.body.trim()}\n\n` +
    `---\n\n### 下载与校验\n\n` +
    `请使用**本 Release 附件**中的 DMG 和 SHA256SUMS.txt，不要使用上游安装包。将两者放在同一目录后执行：\n\n` +
    "```sh\nshasum -a 256 -c SHA256SUMS.txt\n```\n\n" +
    `首次打开可能需要在 macOS「隐私与安全性」中允许；不要全局关闭 Gatekeeper。\n\n` +
    `- [上游构建基线](https://github.com/${upstreamRepository}/commit/${upstream})\n` +
    `- [本次已测试源码](https://github.com/${personalRepository}/commit/${sha})\n` +
    `- [GitHub Actions 构建记录](https://github.com/${personalRepository}/actions/runs/${runId})\n`;
}

export function publishPersonal(root, artifactDir, bundle, env = process.env) {
  const { GITHUB_REPOSITORY: repo, CANDIDATE_SHA: sha, BASE_SHA: base, UPSTREAM_SHA: upstream,
    BUILD_VERSION: version, GITHUB_RUN_NUMBER: runNumber, GITHUB_RUN_ID: runId } = env;
  if (repo !== "zideliu/CodexPlusPlus") throw new Error("Unexpected publication repository");
  if (![base, upstream].every(s => /^[a-f0-9]{40}$/.test(s || ""))) throw new Error("Invalid source commits");
  const { tag, filename } = releaseIdentity(version, runNumber, sha);
  const assets = verifyAssets(artifactDir, filename);
  const metadata = path.join(env.RUNNER_TEMP || root, "latest.json");
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
  const body = personalReleaseNotes({ version, runNumber, sha, upstream, runId }, resolveUpstreamNotes(version, upstream, { git, gh }));
  // Release and in-app update descriptions must use the very same string.
  const manifest = latestManifest(version, runNumber, sha, artifactDir, body);
  writeFileSync(metadata, `${JSON.stringify(manifest, null, 2)}\n`);
  const notes = path.join(env.RUNNER_TEMP || root, "personal-release-notes.md");
  writeFileSync(notes, body);
  // Normal atomic push: concurrent branch updates cannot be overwritten.
  git("-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "push", "--atomic",
    `https://github.com/${repo}.git`, `${sha}:refs/heads/personal-macos`, `${sha}:refs/tags/${tag}`);
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
