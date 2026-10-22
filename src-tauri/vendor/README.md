# Windows transparent-window resize patches

These are the crates.io sources for `softbuffer 0.4.8` and
`tauri-runtime-wry 2.11.2`, with the Windows patches listed below. Cargo
patches and the root lockfile select these versions; other platform backends are unchanged. A small
Windows test harness uses the real library source without unrelated example
dependencies.

The Windows log from 2026-10-22 recorded a panic in
`softbuffer/src/backends/win32.rs` when `CreateCompatibleDC` returned null
during sidebar resizing. Both the allocator and its Tauri caller need to
handle this failure without unwinding out of the native event loop.

- `softbuffer/src/backends/win32.rs`: restore the previous selected bitmap
  before deleting a buffer; return allocation/selection errors with cleanup;
  retain the old buffer when a replacement cannot be allocated. Capture the
  device-context error on the allocator thread.
- `tauri-runtime-wry/src/window/windows.rs`: log and skip a failed background
  redraw instead of unwrapping the error. A later redraw can retry.

Windows regression tests cover injected device-context allocation failure
and 2,000 buffer replacements, checking that each old bitmap is released:

```sh
cargo test --manifest-path src-tauri/vendor/softbuffer-0.4.8/tests/windows/Cargo.toml --lib --locked backends::win32::tests
```

Original sources and licenses:

- <https://crates.io/crates/softbuffer/0.4.8> (MIT / Apache-2.0)
- <https://crates.io/crates/tauri-runtime-wry/2.11.2> (MIT / Apache-2.0)

Remove these overrides after upgrading to upstream versions containing both
the allocation error handling and the caller-side recovery.
