// Read-only update-channel smoke test: never downloads or launches an installer.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let version = codex_plus_core::version::VERSION;
    if std::env::args().any(|arg| arg == "--version") {
        anyhow::ensure!(codex_plus_core::update::personal_build_number(version)?.is_some(), "Missing personal runtime build number");
        if let Ok(expected) = std::env::var("CODEX_PLUS_BUILD_VERSION") {
            anyhow::ensure!(version == expected, "Runtime build number mismatch");
        }
        println!("{version}");
        return Ok(());
    }
    let result = codex_plus_core::update::check_for_update(version).await?;
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
