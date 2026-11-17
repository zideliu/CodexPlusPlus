# Personal macOS Build

Modified on 2026-11-15 for a personal, ad-free Codex++ build.
This is an unofficial derivative of BigPizzaV3/CodexPlusPlus, not an OpenAI product.
The original AGPL-3.0-only license and third-party notices remain in effect.

The default `personal-macos` branch includes upstream 2.7.1 (`7abbcf2`), merged on
2026-11-17 while preserving the personal changes. The `main` branch retains
upstream history independently.

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
The DMG and `SHA256SUMS.txt` are uploaded to a draft first; the Release becomes public only after both uploads are verified.
Failed syncs/tests/builds preserve the previously published Release. A publication failure may leave a draft for retry.
Use GitHub Actions notification settings to receive failure notifications; no personal access token is required.

## Build and Download

1. Open the fork's Actions tab and enable workflows if GitHub prompts you.
2. Select **Build macOS (no ads)**, then **Run workflow** on `personal-macos`.
3. Manual runs also check/merge upstream and always build, even without new commits.
4. After success, download the DMG and `SHA256SUMS.txt` from the repository's Releases page.
   The run's Artifacts section also retains a ZIP for 30 days; Release assets do not have that expiry.

The workflow builds on `macos-15`, supports Apple Silicon and Intel, and uses ad-hoc signing.
It does not require Apple developer certificates, notarization credentials, or provider API keys.
Do not upload application settings, tokens, or local account data to this repository.

## Installation and Updates

Back up the existing Codex++ application and configuration before replacing it.
macOS may require approval under Privacy & Security for this unnotarized build.
Do not disable Gatekeeper globally. Screen recording/accessibility permissions may need to be granted again.

Use builds from this fork for updates. Installing an upstream release restores upstream behavior, including advertisements.
The application update source has not been changed; do not use its upstream installer to update this personal build.
If an automatic sync stops on conflicts, resolve them manually while retaining the no-ads tests, then run the workflow again.
