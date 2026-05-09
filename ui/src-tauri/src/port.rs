//! Free port allocator.

use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};

/// Bind a temporary listener on 127.0.0.1:0, read the assigned port,
/// then drop the listener so the port is free for the next binder.
///
/// Returns an error if no ephemeral port can be acquired (essentially
/// "the OS is out of resources" — extremely rare).
pub fn pick_free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?;
    let port = listener.local_addr()?.port();
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_a_nonzero_port() {
        let port = pick_free_port().expect("should pick a port");
        assert_ne!(port, 0);
    }

    #[test]
    fn returns_different_ports_on_repeated_calls() {
        // Not strictly guaranteed, but extremely likely on a healthy OS.
        let mut seen = std::collections::HashSet::new();
        for _ in 0..5 {
            seen.insert(pick_free_port().unwrap());
        }
        assert!(seen.len() > 1, "expected variety in allocated ports");
    }

    #[test]
    fn picked_port_is_actually_bindable() {
        let port = pick_free_port().unwrap();
        let listener = TcpListener::bind(("127.0.0.1", port));
        assert!(listener.is_ok(), "newly picked port should be free");
    }
}
