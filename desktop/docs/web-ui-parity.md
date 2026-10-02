# Desktop/Web UI Parity

The desktop client reimplements the Dogmedia web vault hierarchy with native
Dioxus/Blitz elements. It does not embed or execute the React application.

## Surface matrix

| Web surface | Native outcome |
|---|---|
| Persistent library sidebar | Brand, All Media, Favorites, categories, access state, settings, version |
| Dashboard header | Search plus connection and refresh affordances |
| Media type pills | All, Music, Video, Photos |
| Featured panel | Dashboard-selected media with first-visible fallback |
| Media track list | Matching hierarchy and density with cursor pagination |
| Bottom player | Three-zone layout using existing playback controls |
| Full player | Immersive artwork/video, metadata, controls, lyrics, subtitles |
| Queue | On-demand right panel with existing native queue actions |
| Settings | Vault styling around native server, trust, and theme fields |
| Admin, Wrapped, sharing, EQ, sleep timer | Out of scope |

## Blitz compatibility

| Primitive | Decision |
|---|---|
| CSS custom properties | Used; already proven by the native spike |
| Grid and flexbox | Used; already proven by library/player views |
| Fixed positioning | Used for player, full player, queue, and dialog |
| `aspect-ratio` | Used for artwork and video stage |
| Media queries | Used for a compact layout below 980px |
| `prefers-color-scheme` | Used only by the explicit `system` theme |
| `prefers-reduced-motion` | Used to disable transitions |
| Overflow scrolling | Used for the rail, library, queue, and lyrics |
| Range inputs | Used for seek and volume; already proven by playback |
| Inline SVG | Avoided to keep the beta renderer path small; text glyphs carry icons |
| Image data URLs | Used for thumbnails and protected photos |

Browser-only `color-mix()`, `backdrop-filter`, nested CSS, Tailwind `@apply`,
dynamic viewport units, and JavaScript layout logic are deliberately excluded.
Inter is requested through the native system-font stack rather than bundled
through `@font-face`.

Settings is the top modal layer and closes the queue when opened. The queue is
non-modal and sits above the mini player. The full player owns the single live
WGPU canvas and may show the queue above it.

The supported minimum window width is 760px. Below 980px the rail becomes
narrower and secondary table/player metadata is hidden before primary controls.
