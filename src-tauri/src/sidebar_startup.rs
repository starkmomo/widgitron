use std::sync::atomic::{AtomicBool, Ordering};

/// Window construction can pump the native event loop. Never wait on another
/// initializer here: it may itself be waiting for the UI thread to build a
/// WebView. Only the owner may create the window and publish the controller.
#[derive(Default)]
pub struct StartupGate(AtomicBool);

impl StartupGate {
    pub const fn new() -> Self {
        Self(AtomicBool::new(false))
    }

    pub fn try_enter(&self) -> Option<StartupClaim<'_>> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| StartupClaim { gate: self })
    }
}

pub struct StartupClaim<'a> {
    gate: &'a StartupGate,
}

impl Drop for StartupClaim<'_> {
    fn drop(&mut self) {
        self.gate.0.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reentrant_and_concurrent_start_cannot_create_another_window() {
        let gate = StartupGate::new();
        let owner = gate.try_enter().unwrap();
        // Simulate a frontend request during WebView construction, before the
        // controller has been published. It must return without waiting.
        assert!(gate.try_enter().is_none());
        std::thread::scope(|scope| {
            let readers: Vec<_> = (0..8)
                .map(|_| {
                    scope.spawn(|| {
                        assert!(gate.try_enter().is_none());
                    })
                })
                .collect();
            for reader in readers {
                reader.join().unwrap();
            }
        });
        drop(owner);
    }

    #[test]
    fn failed_construction_releases_the_claim_for_retry() {
        let gate = StartupGate::new();
        let attempt = || -> Result<(), &str> {
            let _owner = gate.try_enter().unwrap();
            Err("native window creation failed")
        };
        assert!(attempt().is_err());
        assert!(gate.try_enter().is_some());
    }
}
