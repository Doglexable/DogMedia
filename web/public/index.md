# Dogmedia

> Koleksimu, ceritamu, ritmemu sendiri.
> A private media library for streaming music, videos, and photos.

## Overview
Dogmedia is a private, self-hosted streaming platform designed for personal collections of music, videos, and photos with high-fidelity streaming, synchronized lyrics, custom audio equalization, playlist sharing, and multi-device playback synchronization.

## Client Applications
- **Web App**: Progressive Web Application (PWA) with responsive design, offline caching, and MediaSession integration.
- **Desktop Client**: Native Rust (Dioxus / Blitz) desktop player with hardware-accelerated playback (MPV / GStreamer), MPRIS integration, and lyrics display.
- **Mobile Client**: React Native / Expo application with background audio support and offline storage.

## Key Capabilities
- **Audio & Music**: Lossless and multi-quality audio playback, synchronized lyrics, 10-band equalizer, album art extraction, queue management, and shareable 10-second lyric cards and reels.
- **Video & Movies**: Multi-resolution adaptive video transcoding (1080p, 720p, 480p, 360p), subtitle tracks (WebVTT / ASS via libass / JASSUB), and range-based seeking.
- **Photo Library**: High-performance image viewer with automatic thumbnail generation.
- **Listening Wrapped**: Detailed personal listening statistics and annual timeline recaps.
- **Privacy & Security**: Account-based authentication, Redis-backed sessions, role-based access control, and strict content boundary enforcement.

## Access Policy
This is a private instance. All media streaming endpoints and personal library assets require valid account credentials and an active session.

- **Web Access**: Visit `/` in a standard web browser for the graphical client.
- **API**: Endpoints are served under `/api/` (requires authentication).
