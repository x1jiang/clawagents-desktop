//! macOS Keychain wrapper using the `keyring` crate.

use keyring::Entry;

/// Store `secret` under (service, account). Overwrites any existing entry.
pub fn set(service: &str, account: &str, secret: &str) -> Result<(), String> {
    let entry = Entry::new(service, account).map_err(|e| format!("keyring: {e}"))?;
    entry.set_password(secret).map_err(|e| format!("keyring: {e}"))?;
    Ok(())
}

/// Retrieve the secret if any. Returns `Ok(None)` if no entry exists.
pub fn get(service: &str, account: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(service, account).map_err(|e| format!("keyring: {e}"))?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// This test hits the real macOS Keychain; run with:
    ///   cargo test --lib keyring_cmd -- --ignored --include-ignored
    /// After running, you'll see a "com.clawagents.test" entry in
    /// Keychain Access.app — delete it manually if you want to clean up.
    #[test]
    #[ignore = "requires macOS Keychain interaction"]
    fn set_and_get_round_trip() {
        let svc = "com.clawagents.test";
        let acct = "task8-test";
        set(svc, acct, "topsecret").unwrap();
        assert_eq!(get(svc, acct).unwrap(), Some("topsecret".to_string()));
    }

    #[test]
    #[ignore = "requires macOS Keychain interaction"]
    fn get_missing_returns_none() {
        // Use a unique service name so we don't accidentally match real entries.
        let svc = "com.clawagents.test.never-exists-xyz";
        assert_eq!(get(svc, "missing").unwrap(), None);
    }
}
