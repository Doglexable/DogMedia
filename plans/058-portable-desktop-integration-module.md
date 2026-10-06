# Plan 058: Compile the desktop integration module on macOS

## Status

- **Priority**: P2
- **Effort**: S
- **Category**: portability
- **Status**: DONE (2026-10-06)

## Cause

`desktop/src/lib.rs` compiled `integration` only on Linux, while `ui` was
compiled on every target with `native-ui`. The UI imports
`crate::integration::mpris`, so macOS failed with an unresolved import before
linking. This was a module gate mismatch, not a failure to compile
`mpris-server`: version 0.9.0 and its Rust dependencies compile for
`aarch64-apple-darwin`.

## Change

Gate `integration` on `native-ui` alone in `desktop/src/lib.rs`. Keep the
existing runtime behavior in `mpris.rs`: when no D-Bus session bus is present,
log a warning and let the application continue. Native macOS Now Playing
support through MPRemoteCommand belongs to a separate plan.

## Verification

`cargo zigbuild --target aarch64-apple-darwin --release --locked --offline
-p dogmedia-desktop --bin dogmedia-desktop` completes with the macOS SDK,
GStreamer framework, and explicit ColorSync/CarbonCore link flags.
