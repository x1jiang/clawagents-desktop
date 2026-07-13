//! macOS Keychain wrapper using the `keyring` crate.
//!
//! API keys are stored as **one** Keychain item (`api_keys_v1` JSON blob) so
//! macOS only prompts once per unlock, instead of once per provider.
//! Legacy per-provider entries are migrated on first read.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use keyring::Entry;
use serde_json::{json, Value};

const BUNDLE_ACCOUNT: &str = "api_keys_v1";
const PROVIDERS: &[&str] = &["openai", "anthropic", "gemini"];

static CACHE: OnceLock<Mutex<HashMap<(String, String), Option<String>>>> = OnceLock::new();
static BUNDLE_LOADED: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<(String, String), Option<String>>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn bundle_loaded() -> &'static Mutex<std::collections::HashSet<String>> {
    BUNDLE_LOADED.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

fn cache_key(service: &str, account: &str) -> (String, String) {
    (service.to_string(), account.to_string())
}

fn is_provider(account: &str) -> bool {
    PROVIDERS.iter().any(|p| *p == account)
}

fn read_entry_raw(service: &str, account: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(service, account).map_err(|e| format!("keyring: {e}"))?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring: {e}")),
    }
}

fn write_entry_raw(service: &str, account: &str, secret: &str) -> Result<(), String> {
    let entry = Entry::new(service, account).map_err(|e| format!("keyring: {e}"))?;
    entry
        .set_password(secret)
        .map_err(|e| format!("keyring: {e}"))
}

fn delete_entry_raw(service: &str, account: &str) -> Result<(), String> {
    let entry = Entry::new(service, account).map_err(|e| format!("keyring: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring: {e}")),
    }
}

fn parse_bundle(raw: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return out;
    };
    let Some(obj) = v.as_object() else {
        return out;
    };
    for p in PROVIDERS {
        if let Some(s) = obj.get(*p).and_then(|x| x.as_str()) {
            if !s.is_empty() {
                out.insert((*p).to_string(), s.to_string());
            }
        }
    }
    out
}

fn bundle_json(map: &HashMap<String, String>) -> String {
    let mut obj = serde_json::Map::new();
    for p in PROVIDERS {
        if let Some(v) = map.get(*p) {
            if !v.is_empty() {
                obj.insert((*p).to_string(), json!(v));
            }
        }
    }
    Value::Object(obj).to_string()
}

/// Load the single-item bundle into the process cache (at most one Keychain
/// unlock for all providers). Migrates legacy per-provider items once.
fn ensure_providers_cached(service: &str) -> Result<(), String> {
    {
        let loaded = bundle_loaded().lock().map_err(|e| e.to_string())?;
        if loaded.contains(service) {
            return Ok(());
        }
    }

    let mut map: HashMap<String, String> = HashMap::new();
    let mut migrated = false;

    if let Some(raw) = read_entry_raw(service, BUNDLE_ACCOUNT)? {
        map = parse_bundle(&raw);
    } else {
        // One-time migration from old per-provider Keychain items.
        for p in PROVIDERS {
            if let Some(v) = read_entry_raw(service, p)? {
                if !v.is_empty() {
                    map.insert((*p).to_string(), v);
                    migrated = true;
                }
            }
        }
        if migrated {
            let _ = write_entry_raw(service, BUNDLE_ACCOUNT, &bundle_json(&map));
            for p in PROVIDERS {
                let _ = delete_entry_raw(service, p);
            }
        } else {
            // Ensure the bundle item exists so future unlocks hit one ACL.
            let _ = write_entry_raw(service, BUNDLE_ACCOUNT, "{}");
        }
    }

    if let Ok(mut guard) = cache().lock() {
        for p in PROVIDERS {
            let val = map.get(*p).cloned();
            guard.insert(cache_key(service, p), val);
        }
    }
    if let Ok(mut loaded) = bundle_loaded().lock() {
        loaded.insert(service.to_string());
    }
    Ok(())
}

fn write_bundle_from_cache(service: &str) -> Result<(), String> {
    let mut map = HashMap::new();
    if let Ok(guard) = cache().lock() {
        for p in PROVIDERS {
            if let Some(Some(v)) = guard.get(&cache_key(service, p)) {
                if !v.is_empty() {
                    map.insert((*p).to_string(), v.clone());
                }
            }
        }
    }
    write_entry_raw(service, BUNDLE_ACCOUNT, &bundle_json(&map))
}

/// Store `secret` under (service, account). Overwrites any existing entry.
pub fn set(service: &str, account: &str, secret: &str) -> Result<(), String> {
    if is_provider(account) {
        let _ = ensure_providers_cached(service);
        if let Ok(mut guard) = cache().lock() {
            guard.insert(cache_key(service, account), Some(secret.to_string()));
        }
        write_bundle_from_cache(service)?;
        return Ok(());
    }
    write_entry_raw(service, account, secret)?;
    if let Ok(mut guard) = cache().lock() {
        guard.insert(cache_key(service, account), Some(secret.to_string()));
    }
    Ok(())
}

/// Retrieve the secret if any. Returns `Ok(None)` if no entry exists.
pub fn get(service: &str, account: &str) -> Result<Option<String>, String> {
    if is_provider(account) {
        ensure_providers_cached(service)?;
        if let Ok(guard) = cache().lock() {
            if let Some(cached) = guard.get(&cache_key(service, account)) {
                return Ok(cached.clone());
            }
        }
        return Ok(None);
    }
    if let Ok(guard) = cache().lock() {
        if let Some(cached) = guard.get(&cache_key(service, account)) {
            return Ok(cached.clone());
        }
    }
    let value = read_entry_raw(service, account)?;
    if let Ok(mut guard) = cache().lock() {
        guard.insert(cache_key(service, account), value.clone());
    }
    Ok(value)
}

/// All known provider keys in one shot (single Keychain unlock via bundle).
pub fn get_all_providers(service: &str) -> Result<HashMap<String, Option<String>>, String> {
    ensure_providers_cached(service)?;
    let mut out = HashMap::new();
    if let Ok(guard) = cache().lock() {
        for p in PROVIDERS {
            out.insert(
                (*p).to_string(),
                guard
                    .get(&cache_key(service, p))
                    .cloned()
                    .unwrap_or(None),
            );
        }
    }
    Ok(out)
}

/// Delete the secret if present. Missing entries are treated as success.
pub fn delete(service: &str, account: &str) -> Result<(), String> {
    if is_provider(account) {
        let _ = ensure_providers_cached(service);
        if let Ok(mut guard) = cache().lock() {
            guard.insert(cache_key(service, account), None);
        }
        write_bundle_from_cache(service)?;
        let _ = delete_entry_raw(service, account); // legacy cleanup
        return Ok(());
    }
    delete_entry_raw(service, account)?;
    if let Ok(mut guard) = cache().lock() {
        guard.insert(cache_key(service, account), None);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_round_trip_json() {
        let mut map = HashMap::new();
        map.insert("openai".into(), "sk-test".into());
        let raw = bundle_json(&map);
        let parsed = parse_bundle(&raw);
        assert_eq!(parsed.get("openai").map(String::as_str), Some("sk-test"));
        assert!(!parsed.contains_key("anthropic"));
    }
}
