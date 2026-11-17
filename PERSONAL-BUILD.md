# Personal macOS Build

Modified on 2026-11-15 for a personal, ad-free Codex++ build.
This is an unofficial derivative of BigPizzaV3/CodexPlusPlus, not an OpenAI product.
The original AGPL-3.0-only license and third-party notices remain in effect.

The default `personal-macos` branch contains the verified changes based on upstream
2.6.10 (`f116127`). The `main` branch retains upstream history independently.

## Changes

- Home shows Agent/gateway status and shortcuts without sponsor cards or refresh controls.
- The provider-page sponsor prompt and injected Codex recommendation navigation are removed.
- The add-provider catalog omits the sponsored group; existing configured providers and custom-provider entry remain available.
- Both the backend advertisement endpoint and the injected renderer return no advertisements without contacting advertising servers.
- Gateway routing, provider configuration, extensions, and themes remain unchanged.
- Upstream automation is restricted to the upstream repository. This fork uses a manual macOS-only build.

## Build and Download

1. Open the fork's Actions tab and enable workflows if GitHub prompts you.
2. Select **Build macOS (no ads)**, then **Run workflow** on `personal-macos`.
3. After success, download `codex-plus-plus-macos-noads-<run number>` from the run's Artifacts section.
4. Extract the artifact ZIP to obtain the universal DMG and SHA256 checksums.

The workflow builds on `macos-15`, supports Apple Silicon and Intel, and uses ad-hoc signing.
It does not require Apple developer certificates, notarization credentials, or provider API keys.
Do not upload application settings, tokens, or local account data to this repository.

## Installation and Updates

Back up the existing Codex++ application and configuration before replacing it.
macOS may require approval under Privacy & Security for this unnotarized build.
Do not disable Gatekeeper globally. Screen recording/accessibility permissions may need to be granted again.

Use builds from this fork for updates. Installing an upstream release restores upstream behavior, including advertisements.
The application update source has not been changed; do not use its upstream installer to update this personal build.
When merging upstream changes, rerun the no-ads regression tests and check the macOS workflow before installation.
