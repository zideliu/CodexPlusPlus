# Personal macOS Build

Modified on 2026-11-15 for a personal, ad-free Codex++ build.
This is an unofficial derivative of BigPizzaV3/CodexPlusPlus, not an OpenAI product.
The original AGPL-3.0-only license and third-party notices remain in effect.

The default `personal-macos` branch tracks upstream `main` and carries the personal changes.
Each Release links to the exact upstream commit included in the build.

## Changes

- Home shows Agent/gateway status and shortcuts without sponsor cards or refresh controls.
- The provider-page sponsor prompt and injected Codex recommendation navigation are removed.
- The add-provider catalog omits the sponsored group; existing configured providers and custom-provider entry remain available.
- Both the backend advertisement endpoint and the injected renderer return no advertisements without contacting advertising servers.
- Gateway routing, provider configuration, extensions, and themes remain unchanged.
- Upstream automation is restricted to the upstream repository. This fork runs its own macOS build and Release workflow.

## Automatic Sync

Every day at 02:17 UTC (10:17 Asia/Shanghai), the workflow checks upstream `main`.
GitHub may delay scheduled runs. No upstream changes means no build and no new Release.
Public repositories may have schedules disabled by GitHub after 60 days without repository activity;
check the Actions page if automated checks stop.

The workflow makes a normal merge candidate without pushing it. It regenerates derived renderer files,
but stops on source conflicts, personal manifest changes, or changes to workflows/publication safeguards.
All frontend checks, no-ads regressions, Rust ad tests, universal compilation and signature checks must pass
before the candidate is pushed to `personal-macos`. There is no force push and personal modifications are not discarded.
A concurrent branch update also stops publication so a stale build cannot overwrite newer work.

Successful builds receive a unique `v<version>-noads.<run number>` tag and GitHub Release.
The DMG, `SHA256SUMS.txt`, and `latest.json` are uploaded to a draft first; the Release becomes public only after all uploads are verified.
Failed syncs/tests/builds preserve the previously published Release. A publication failure may leave a draft for retry.
Use GitHub Actions notification settings to receive failure notifications; no personal access token is required.

## Release Notes

Each publication reads the upstream Release for the exact built version (`v<upstream version>`),
never the upstream latest Release. If its body is missing, empty, or unavailable, the publisher reads
the matching `CHANGELOG.md` section from the pinned upstream commit included in the build.
If neither source has that version's notes, publication stops instead of showing unrelated changes.

The upstream text is attributed and placed inside a personal-build wrapper explaining the no-ads changes,
fork update channel, and ad-hoc signing limitations. This exact combined body is used both for the GitHub
Release description and `latest.json.body`. Installer URLs, version, source commit, size and SHA256
continue to come from this fork's verified build, not from the upstream Release assets.
This copies notes at publication time; it does not continuously rewrite older Releases when upstream edits them.

## Build and Download

1. Open the fork's Actions tab and enable workflows if GitHub prompts you.
2. Select **Build macOS (no ads)**, then **Run workflow** on `personal-macos`.
3. The default run checks for new upstream commits. To publish a fork-only change or intentionally rebuild the same source, select **Build and publish even if upstream is already merged**.
4. After success, download the DMG and `SHA256SUMS.txt` from the repository's Releases page.
   The run's Artifacts section also retains a ZIP for 30 days; Release assets do not have that expiry.

The frontend builds once. Two `macos-15` runners compile the Apple Silicon and Intel release binaries in parallel, each with its own dependency cache. The Apple Silicon build also produces the update checker in the same Cargo invocation. Rust regression tests run alongside both builds. The packaging job combines the two binaries with `lipo` and verifies the ad-hoc signatures and architectures before publication.
It does not require Apple developer certificates, notarization credentials, or provider API keys.
Do not upload application settings, tokens, or local account data to this repository.

## Installation and Updates

Back up the existing Codex++ application and configuration before replacing it.
macOS may require approval under Privacy & Security for this unnotarized build.
Do not disable Gatekeeper globally. Screen recording/accessibility permissions may need to be granted again.

Builds starting with noads.5 embed the full personal build version and use only
`https://github.com/zideliu/CodexPlusPlus/releases/latest/download/latest.json` for in-app updates.
Same-upstream builds compare the numeric `noads` suffix (10 is newer than 9); identical builds are not offered again.
The updater rejects non-personal versions and installer URLs outside the matching Release in this fork.
Downloads and cached installers are verified against the SHA256 from `latest.json`.
macOS still validates the application identity, signature and exact planned build before replacement.

**One-time migration:** old installed builds through noads.4 still use the original update source.
Install the new fork DMG manually once; do not use an old build's in-app update to switch channels.
Moving from an upstream Developer ID signature to an ad-hoc signature may require manual installation
and renewed system permissions. No signature or Gatekeeper checks are disabled by this change.

Use builds from this fork for updates. Manually installing an upstream release still restores upstream behavior, including advertisements.
If you merge a conflict resolution directly into `personal-macos`, use the manual rebuild option to publish that commit.
