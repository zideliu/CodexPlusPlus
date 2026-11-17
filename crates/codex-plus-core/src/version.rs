pub const VERSION: &str = match option_env!("CODEX_PLUS_BUILD_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

#[cfg(test)]
mod tests {
    use super::VERSION;

    #[test]
    fn exposes_workspace_version() {
        assert_eq!(VERSION, option_env!("CODEX_PLUS_BUILD_VERSION").unwrap_or(env!("CARGO_PKG_VERSION")));
        if option_env!("CODEX_PLUS_BUILD_VERSION").is_some() {
            assert!(VERSION.starts_with(&format!("{}-noads.", env!("CARGO_PKG_VERSION"))));
            assert!(crate::update::personal_build_number(VERSION).unwrap().is_some());
        }
    }
}
