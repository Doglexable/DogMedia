# Implementation Plans for SessionConflictCard Memory Optimizations

**Repository commit:** `ee9dacf`

This directory contains self‑contained, executor‑ready plans that address the six identified optimization opportunities (see the analysis report). Plans are numbered in the order they should be tackled, respecting dependencies.

| # | Plan | Goal | Effort (S/M/L) | Dependencies |
|---|------|------|----------------|--------------|
| 001 | Granular signal updates | Reduce full‑tree re‑render on each WebSocket event | S | – |
| 002 | Debounce / throttle `observe_remote` | Avoid per‑second diff when no meaningful change | S | 001 |
| 003 | Malloc trim after socket batch | Return idle heap pages to OS | S | 001,002 |
| 004 | Artwork cache size limit (LRU) | Prevent unbounded thumbnail memory growth | M | 001 |
| 005 | Reuse a single WGPU surface | Eliminate duplicate pipeline allocations | M | 001 |
| 006 | Isolate `SessionConflictCard` state | Render only this component on session‑unavailable changes | S | 001,002 |

**Execution order**: Start with 001, then 002, 003, 006 (they all rely on the new signal), followed by 004 and 005 which can be done in parallel after the signal groundwork.

Each plan file follows the standard template (see `references/plan-template.md`).
