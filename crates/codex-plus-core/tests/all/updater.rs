use codex_plus_core::update::{
    Release, download_asset_to, is_newer_version, parse_version_tag, release_from_github_payload,
    release_from_latest_json_payload, safe_asset_name, select_update_asset,
};
use serde_json::json;
use sha2::{Digest, Sha256};

fn personal_release(build: u64, bytes: &[u8]) -> Release {
    let version = format!("2.7.1-noads.{build}");
    let name = format!("CodexPlusPlus-{version}-macos-universal.dmg");
    Release {
        url: format!("https://github.com/zideliu/CodexPlusPlus/releases/tag/v{version}"),
        asset_url: Some(format!("https://github.com/zideliu/CodexPlusPlus/releases/download/v{version}/{name}")),
        version,
        body: String::new(),
        asset_name: Some(name),
        sha256: Some(format!("{:x}", Sha256::digest(bytes))),
    }
}

#[test]
fn personal_build_comparison_is_numeric_and_not_upstream_prerelease_ordering() {
    assert!(is_newer_version("v2.7.1-noads.10", "2.7.1-noads.9").unwrap());
    assert!(!is_newer_version("2.7.1-noads.9", "2.7.1-noads.10").unwrap());
    assert!(!is_newer_version("v2.7.1-noads.10", "2.7.1-noads.10").unwrap());
    assert!(is_newer_version("2.7.1-noads.1", "2.7.1").unwrap());
    assert!(!is_newer_version("2.7.1", "2.7.1-noads.1").unwrap());
    assert!(is_newer_version("2.8.0-noads.1", "2.7.1-noads.999").unwrap());
    assert!(!is_newer_version("2.7.1-noads.999", "2.8.0-noads.1").unwrap());
    for invalid in ["2.7.1-noads.0", "2.7.1-noads.x", "2.7.1-noads.1extra", "2.7.1-noads", "2.7.1-noads.18446744073709551616"] {
        assert!(is_newer_version(invalid, "2.7.1").is_err(), "{invalid}");
    }
}

#[test]
fn personal_update_channel_rejects_upstream_or_mismatched_assets() {
    use codex_plus_core::update::{DEFAULT_LATEST_JSON_URL, DEFAULT_REPOSITORY, validate_personal_release};
    assert_eq!(DEFAULT_REPOSITORY, "zideliu/CodexPlusPlus");
    assert_eq!(DEFAULT_LATEST_JSON_URL, "https://github.com/zideliu/CodexPlusPlus/releases/latest/download/latest.json");
    let release = personal_release(5, b"test");
    validate_personal_release(&release).unwrap();
    let mut invalid = release.clone();
    invalid.asset_url = invalid.asset_url.map(|url| url.replace("zideliu", "BigPizzaV3"));
    assert!(validate_personal_release(&invalid).is_err());
    invalid = release.clone();
    invalid.version = "2.8.0".into();
    assert!(validate_personal_release(&invalid).is_err());
    invalid = release.clone();
    invalid.asset_url = invalid.asset_url.map(|url| format!("{url}?redirect=upstream"));
    assert!(validate_personal_release(&invalid).is_err());
    invalid = release.clone();
    invalid.asset_name = Some("../package.dmg".into());
    assert!(validate_personal_release(&invalid).is_err());
    invalid = release.clone();
    invalid.sha256 = None;
    assert!(validate_personal_release(&invalid).is_err());
}

#[tokio::test]
async fn personal_update_rejects_invalid_source_before_cache_or_network() {
    let dir = tempfile::tempdir().unwrap();
    let mut release = personal_release(5, b"cached");
    download_asset_to(&release, b"cached", dir.path()).unwrap();
    release.asset_url = Some("https://github.com/BigPizzaV3/CodexPlusPlus/releases/download/v9/app.dmg".into());
    assert!(codex_plus_core::update::download_update_with_progress(&release, dir.path(), |_| {}).await.is_err());
    assert!(codex_plus_core::update::perform_update_with_progress(&release, dir.path(), |_| {}).await.is_err());
}

#[test]
fn personal_update_checks_digest_even_for_same_size_cached_files() {
    let dir = tempfile::tempdir().unwrap();
    let release = personal_release(5, b"correct");
    assert!(download_asset_to(&release, b"corrupt", dir.path()).is_err());
    let file = download_asset_to(&release, b"correct", dir.path()).unwrap();
    assert!(codex_plus_core::update::downloaded_installer(&release, dir.path()).is_some());
    std::fs::write(file, b"corrupt").unwrap();
    assert!(codex_plus_core::update::downloaded_installer(&release, dir.path()).is_none());
}

#[test]
fn personal_installer_cleanup_keeps_later_builds_of_same_upstream_version() {
    let dir = tempfile::tempdir().unwrap();
    for build in [4, 5, 10] {
        let release = personal_release(build, b"test");
        std::fs::write(dir.path().join(release.asset_name.unwrap()), b"test").unwrap();
    }
    let removed = codex_plus_core::update::prune_installed_installers(dir.path(), "2.7.1-noads.5");
    assert_eq!(removed.len(), 2);
    assert!(dir.path().join(personal_release(10, b"").asset_name.unwrap()).exists());
}

#[test]
fn personal_manifest_round_trip_preserves_hash_and_build_number() {
    let release = personal_release(10, b"test");
    let parsed = release_from_latest_json_payload(&json!({
        "version": release.version,
        "url": release.url,
        "assets": [{"name": release.asset_name, "url": release.asset_url, "sha256": release.sha256}]
    })).unwrap();
    #[cfg(target_os = "macos")]
    {
        codex_plus_core::update::validate_personal_release(&parsed).unwrap();
        assert_eq!(parsed.sha256, release.sha256);
    }
    assert_eq!(parsed.version, "2.7.1-noads.10");
}

#[test]
fn parse_version_tag_accepts_prefix_and_suffix() {
    assert_eq!(parse_version_tag("v1.2.3").unwrap(), vec![1, 2, 3]);
    assert_eq!(parse_version_tag("1.2.3").unwrap(), vec![1, 2, 3]);
    assert_eq!(parse_version_tag("v1.2.3-beta.1").unwrap(), vec![1, 2, 3]);
}

#[test]
fn version_comparison_uses_numeric_segments() {
    assert!(is_newer_version("v1.0.10", "1.0.4").unwrap());
    assert!(!is_newer_version("v1.0.4", "1.0.4").unwrap());
    assert!(!is_newer_version("v1.0.3", "1.0.4").unwrap());
}

#[test]
fn github_payload_selects_platform_installer() {
    let release = release_from_github_payload(&json!({
        "tag_name": "v1.0.9",
        "html_url": "https://github.com/BigPizzaV3/CodexPlusPlus/releases/tag/v1.0.9",
        "body": "fixes",
        "assets": [
            {"name": "source.zip", "browser_download_url": "https://example.test/source.zip"},
            {"name": "codex-plus-plus-manager.exe", "browser_download_url": "https://example.test/manager.exe"},
            {"name": "CodexPlusPlus_1.0.9_x64-setup.exe", "browser_download_url": "https://example.test/setup.exe"},
            {"name": "CodexPlusPlus_1.0.9_x64.dmg", "browser_download_url": "https://example.test/app.dmg"}
        ]
    }))
    .unwrap();

    assert_eq!(release.version, "v1.0.9");
    if cfg!(windows) {
        assert_eq!(
            release.asset_name.as_deref(),
            Some("CodexPlusPlus_1.0.9_x64-setup.exe")
        );
    } else if cfg!(target_os = "macos") {
        assert_eq!(
            release.asset_name.as_deref(),
            Some("CodexPlusPlus_1.0.9_x64.dmg")
        );
    } else {
        assert_eq!(release.asset_name.as_deref(), None);
    }
}

#[test]
fn latest_json_payload_selects_platform_installer_without_github_api_shape() {
    let release = release_from_latest_json_payload(&json!({
        "version": "v1.1.6",
        "url": "https://github.com/BigPizzaV3/CodexPlusPlus/releases/tag/v1.1.6",
        "body": "静态更新描述",
        "assets": [
            {"name": "source.zip", "url": "https://example.test/source.zip"},
            {"name": "CodexPlusPlus-1.1.6-windows-x64-setup.exe", "url": "https://example.test/setup.exe"},
            {"name": "CodexPlusPlus-1.1.6-macos-x64.dmg", "url": "https://example.test/app.dmg"}
        ]
    }))
    .unwrap();

    assert_eq!(release.version, "v1.1.6");
    assert_eq!(release.body, "静态更新描述");
    if cfg!(windows) {
        assert_eq!(
            release.asset_name.as_deref(),
            Some("CodexPlusPlus-1.1.6-windows-x64-setup.exe")
        );
    } else if cfg!(target_os = "macos") {
        assert_eq!(
            release.asset_name.as_deref(),
            Some("CodexPlusPlus-1.1.6-macos-x64.dmg")
        );
    } else {
        assert_eq!(release.asset_name.as_deref(), None);
    }
}

#[test]
fn asset_selection_prefers_current_platform_artifacts() {
    let assets = vec![
        (
            "CodexPlusPlus.zip".to_string(),
            "https://example.test/source.zip".to_string(),
        ),
        (
            "codex-plus-plus-manager.exe".to_string(),
            "https://example.test/manager.exe".to_string(),
        ),
        (
            "CodexPlusPlus_1.0.9_x64-setup.exe".to_string(),
            "https://example.test/setup.exe".to_string(),
        ),
        (
            "CodexPlusPlus_1.0.9_x64.dmg".to_string(),
            "https://example.test/app.dmg".to_string(),
        ),
    ];

    if cfg!(windows) {
        let selected = select_update_asset(&assets).unwrap();
        assert_eq!(selected.name, "CodexPlusPlus_1.0.9_x64-setup.exe");
    } else if cfg!(target_os = "macos") {
        let selected = select_update_asset(&assets).unwrap();
        assert_eq!(selected.name, "CodexPlusPlus_1.0.9_x64.dmg");
    } else {
        assert!(select_update_asset(&assets).is_none());
    }
}

#[test]
fn asset_selection_distinguishes_x64_and_arm64_macos_dmgs() {
    // Regression test for the bug where an x86_64 Mac user could be handed
    // the arm64 DMG (or vice versa) because `is_macos_installer_asset` did
    // not check the arch token in the filename.
    let assets = vec![
        (
            "CodexPlusPlus-1.2.17-macos-arm64.dmg".to_string(),
            "https://example.test/app-arm64.dmg".to_string(),
        ),
        (
            "CodexPlusPlus-1.2.17-macos-x64.dmg".to_string(),
            "https://example.test/app-x64.dmg".to_string(),
        ),
    ];

    if cfg!(target_os = "macos") {
        let selected = select_update_asset(&assets)
            .expect("a macOS DMG should be selected for the running arch");
        let expected = match std::env::consts::ARCH {
            "x86_64" => "CodexPlusPlus-1.2.17-macos-x64.dmg",
            "aarch64" => "CodexPlusPlus-1.2.17-macos-arm64.dmg",
            other => panic!("unexpected target arch in test: {other}"),
        };
        assert_eq!(
            selected.name, expected,
            "x86_64 binary must select x64 DMG, aarch64 binary must select arm64 DMG"
        );
    } else {
        // Non-macOS platforms should not pick either macOS DMG.
        assert!(select_update_asset(&assets).is_none());
    }
}

#[test]
fn asset_selection_accepts_universal_macos_dmg_on_either_arch() {
    // A universal DMG carries no arch token at all. `is_macos_native_arch_asset`
    // falls through to its "no arch token — assume it matches" branch, so both
    // x86_64 and arm64 must rank it as a native match. That fallback is what
    // makes the universal build work, so pin it down here: if someone later
    // makes an arch token mandatory, this test is what catches it.
    let assets = vec![(
        "CodexPlusPlus-1.5.4-macos-universal.dmg".to_string(),
        "https://example.test/app-universal.dmg".to_string(),
    )];

    if cfg!(target_os = "macos") {
        let selected = select_update_asset(&assets)
            .expect("the universal DMG must be selectable on any macOS arch");
        assert_eq!(selected.name, "CodexPlusPlus-1.5.4-macos-universal.dmg");
    } else {
        assert!(select_update_asset(&assets).is_none());
    }
}

#[test]
fn asset_selection_prefers_universal_over_single_arch_dmg() {
    // Both shapes are rank 0 for the running arch, so the two must never ship
    // together — this test documents the collision so a mixed release is not
    // mistaken for a safe one. The assertion is deliberately loose about which
    // one wins: the point is that a mixed release is ambiguous.
    let assets = vec![
        (
            "CodexPlusPlus-1.5.4-macos-universal.dmg".to_string(),
            "https://example.test/app-universal.dmg".to_string(),
        ),
        (
            "CodexPlusPlus-1.5.4-macos-arm64.dmg".to_string(),
            "https://example.test/app-arm64.dmg".to_string(),
        ),
    ];

    if cfg!(target_os = "macos") {
        assert!(
            select_update_asset(&assets).is_some(),
            "a macOS installer is selectable when native and universal coexist"
        );
    } else {
        assert!(select_update_asset(&assets).is_none());
    }
}

#[test]
fn safe_asset_name_rejects_path_traversal() {
    assert_eq!(safe_asset_name("pkg.zip").unwrap(), "pkg.zip");
    assert!(safe_asset_name("../pkg.zip").is_err());
    assert!(safe_asset_name("").is_err());
}

#[test]
fn download_asset_to_writes_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let release = Release {
        sha256: None,
        version: "v1.0.9".to_string(),
        url: "https://example.test".to_string(),
        body: "fixes".to_string(),
        asset_name: Some("pkg.zip".to_string()),
        asset_url: Some("https://example.test/pkg.zip".to_string()),
    };

    let path = download_asset_to(&release, b"abcdef", dir.path()).unwrap();

    assert_eq!(path, dir.path().join("pkg.zip"));
    assert_eq!(std::fs::read(path).unwrap(), b"abcdef");
}

#[test]
fn downloaded_installer_requires_complete_marker_with_matching_size() {
    let dir = tempfile::tempdir().unwrap();
    let release = Release {
        sha256: None,
        version: "v1.0.9".to_string(),
        url: "https://example.test".to_string(),
        body: "fixes".to_string(),
        asset_name: Some("pkg.dmg".to_string()),
        asset_url: Some("https://example.test/pkg.dmg".to_string()),
    };
    // 还没下：不算下好。
    assert!(codex_plus_core::update::downloaded_installer(&release, dir.path()).is_none());

    let path = download_asset_to(&release, b"abcdef", dir.path()).unwrap();
    assert_eq!(
        codex_plus_core::update::downloaded_installer(&release, dir.path()),
        Some((path.clone(), 6))
    );
    // 没留下半截的临时文件。
    assert!(!dir.path().join("pkg.dmg.part").exists());

    // 安装包被改过（大小对不上）就不算下好，点「安装」时会重新下载。
    std::fs::write(&path, b"abc").unwrap();
    assert!(codex_plus_core::update::downloaded_installer(&release, dir.path()).is_none());

    // 标记丢了也不算。
    std::fs::write(&path, b"abcdef").unwrap();
    std::fs::remove_file(dir.path().join("pkg.dmg.complete")).unwrap();
    assert!(codex_plus_core::update::downloaded_installer(&release, dir.path()).is_none());
}

#[test]
fn prune_installed_installers_removes_versions_not_newer_than_current() {
    // #3094：装上新版后，不高于当前版本的安装包连同完成标记一起删掉；
    // 后台已下好、比当前新的保留；认不出版本号的文件不动。
    let dir = tempfile::tempdir().unwrap();
    let names = [
        "CodexPlusPlus-2.6.6-windows-x64-setup.exe",
        "CodexPlusPlus-2.6.7-windows-x64-setup.exe",
        "CodexPlusPlus-2.6.8-macos-universal.dmg",
        "CodexPlusPlus-2.10.0-linux-amd64.deb",
        "setup.exe",
        "notes-2.6.6.txt",
    ];
    for name in names {
        std::fs::write(dir.path().join(name), b"x").unwrap();
        std::fs::write(dir.path().join(format!("{name}.complete")), b"1").unwrap();
    }

    let mut removed = codex_plus_core::update::prune_installed_installers(dir.path(), "v2.6.7");
    removed.sort();

    assert_eq!(
        removed,
        vec![
            dir.path().join("CodexPlusPlus-2.6.6-windows-x64-setup.exe"),
            dir.path().join("CodexPlusPlus-2.6.7-windows-x64-setup.exe"),
        ]
    );
    assert!(!dir.path().join("CodexPlusPlus-2.6.6-windows-x64-setup.exe.complete").exists());
    assert!(!dir.path().join("CodexPlusPlus-2.6.7-windows-x64-setup.exe.complete").exists());
    for kept in [
        "CodexPlusPlus-2.6.8-macos-universal.dmg",
        "CodexPlusPlus-2.10.0-linux-amd64.deb",
        "setup.exe",
        "notes-2.6.6.txt",
    ] {
        assert!(dir.path().join(kept).exists(), "{kept} 不应被删除");
    }
    // 目录不存在或版本号非法时什么都不做。
    assert!(codex_plus_core::update::prune_installed_installers(&dir.path().join("missing"), "2.6.7").is_empty());
    assert!(codex_plus_core::update::prune_installed_installers(dir.path(), "dev").is_empty());
}
