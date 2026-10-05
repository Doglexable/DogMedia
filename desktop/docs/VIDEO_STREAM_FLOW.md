# Alur Penerimaan File Stream Video — Desktop Client

> Scope: `desktop/` (Rust + Dioxus Native + GStreamer + wgpu).
> Media type video = `Media.mime_type` diawali `video/` (`desktop/src/domain/media.rs:87`).

## Ringkasan 1 Paragraf

Desktop **tidak men-download file video** sebagai bytes via `reqwest`. Ia meminta **short-lived playback session** ke server, mengubah `stream_url` relatif menjadi URL absolut, lalu menyerahkan URL itu ke **GStreamer `playbin3`** sebagai `uri`. GStreamer yang melakukan HTTP streaming, demux, decode, dan mengeluarkan raw frame (`NV12`/`RGBA`) lewat `appsink`. Frame mentah itu diteruskan via `VideoFrameReceiver` → `VideoPaintSource` (wgpu) → `<canvas>` di Dioxus Native.

## Diagram Alur

```
User klik video
  │
  ▼
play_media_at() [ui/mod.rs:635]
  ├─ coordinator.load(media) → Effect::CreateSession { media_id, quality }
  ├─ player_expanded = true (khusus video, tanpa resume)
  │
  ▼
POST api/media/{id}/playback-session { quality } [api/endpoints.rs:112, api/endpoint.rs:102]
  → PlaybackSession { stream_url: StreamPath, session_id, viewer_id, lease_required, quality }
  │
  ▼
GET resume + client.absolute_url(&session.stream_url) [ui/mod.rs:707,726]
  → ServerUrl::join_stream() → http(s)://host/.../api/media/{id}/stream?...
  │
  ▼
engine.open(&session, &stream_url) [playback/engine.rs:259]
  ├─ simpan ProtectedHeaders { session_id, viewer_id }
  ├─ playbin.set_state(Null), playbin.set_property("uri", stream_url)
  ▼
engine.play() [playback/engine.rs:287] → playbin → Playing
  │
  ▼ (internal GStreamer, signal source-setup)
source-setup callback [playback/engine.rs:226]
  ├─ automatic-redirect = false
  └─ extra-headers: X-Playback-Session, X-Viewer-ID, X-Client-Platform: desktop
  → HTTP GET stream terproteksi (Range/seek didukung server)
  │
  ▼ (decode → appsink new-sample [playback/engine.rs:109])
caps video/x-raw { NV12, RGBA } → copy/rapikan stride → VideoFrame { w, h, format, pixels }
  ├─ buffer recycle pool (max 4)
  └─ redraw callback → request_redraw
  │
  ▼
VideoFrameReceiver::take_frame() → VideoPaintSource::render() [ui/video_surface.rs:560]
  ├─ upload ke texture Y+UV (R8 + RG8) atau RGBA (Rgba8Unorm)
  ├─ shader NV12 (BT.601 <720p, BT.709 ≥720p) / RGBA passthrough
  └─ letterbox scale → target texture → TextureHandle
  │
  ▼
<canvas src="{video_source_id}"> [ui/views/video_player.rs:325]
  + 60fps trigger loop saat video Playing [ui/mod.rs:318]
  + tick_playback() 100ms: position/duration/EOS/error [ui/mod.rs:884]
  + heartbeat 10s: lease + play/pause report [ui/mod.rs:948]
```

## Tahap per Tahap

### 1. Deteksi media video

`desktop/src/domain/media.rs:87-97`:

```rust
is_video() → mime_type.starts_with("video/")
is_audio() → mime_type.starts_with("audio/")
is_photo() → mime_type.starts_with("image/")
```

Cabang di `play_media_at()` (`desktop/src/ui/mod.rs:644`):

- `is_photo()` → `play_photo()` (fetch bytes via `client.photo()`, bukan streaming).
- selain foto (audio/video) → lanjut ke session + engine. Video tambahan: `player_expanded = true` (`ui/mod.rs:670`).

### 2. Minta playback session (bukan file langsung)

`desktop/src/api/endpoints.rs:112-124`:

```rust
POST api/media/{id}/playback-session
Body: { "quality": "low" | "med" | "high" | "ori" }
```

Definisi route: `desktop/src/api/endpoint.rs:102` → `api/media/{id}/playback-session`.
Response di-deserialize ke `PlaybackSession` (`desktop/src/domain/playback.rs:66`):

| Field | Arti |
|---|---|
| `stream_url: StreamPath` | Path relatif, mis. `/api/media/4/stream?quality=high`. Hanya dari server, tidak dikonstruksi lokal (`domain/ids.rs:105`). |
| `session_id: SessionId` | Token proteksi stream, dikirim sebagai header. |
| `viewer_id: ViewerId` | Identitas viewer. |
| `lease_required: bool` | Kalau true, heartbeat wajib, kalau tidak lease dianggap hilang. |
| `quality: Quality` | Kualitas yang dikunci server. |

Header auth untuk request JSON ini dipasang di `client.rs:202-219`: `X-Viewer-ID`, `X-Client-Platform: desktop`, `Accept/Content-Type`.

Sebelum session dibuat, `play_media_at()` juga:

1. `ensure_artwork()` + `load_extras()` (lirik/subtitle) — paralel, tidak blocking video.
2. Release session lama + `send_report(previous, "pause", ...)` agar lease lama tidak bocor (`ui/mod.rs:682,704`).
3. Cek sequence (`snapshot.sequence`) untuk mengabaikan response basi saat user cepat pindah media (`ui/mod.rs:740`).
4. Ambil resume: argumen `resume_at` atau `client.resume(media.id)` dengan guard `< 2.0s → 0.0` dan `>= duration - 3.0 → 0.0` (`ui/mod.rs:707-723`).

### 3. Resolve URL absolut

`desktop/src/api/client.rs:142`:

```rust
client.absolute_url(&session.stream_url)
  → base_url.join_stream(path)  // url.rs:102
```

`ServerUrl` (`api/url.rs:63`) menjamin scheme `http/https`, host ada, path trailing-slash agar prefix sub-path tidak hilang. Hasilnya `url::Url` penuh yang diteruskan ke engine. `engine.open()` menolak scheme selain `http|https` (`playback/engine.rs:264`).

### 4. Serahkan URL ke GStreamer (`PlaybackEngine::open`)

`desktop/src/playback/engine.rs:80-257` (`new`), `259-285` (`open`):

- Elemen: `playbin3` + `video-sink = appsink`.
- `appsink` caps: `video/x-raw, format=(string){ NV12, RGBA }`, `max-buffers=2`, `drop=true`, `emit-signals=true` — selalu frame terbaru, latency rendah.
- `open()` hanya set `uri` + reset `pending_seek`/`last_video_pts`/frame. Tidak ada fetch manual.

### 5. Proteksi stream via `source-setup`

Callback `source-setup` (`playback/engine.rs:226-247`) berjalan di thread GStreamer saat source element dibuat:

```rust
automatic-redirect = false
extra-headers = { X-Playback-Session, X-Viewer-ID, X-Client-Platform: "desktop" }
```

Artinya **penerimaan file stream yang sebenarnya adalah HTTP GET oleh `souphttpsrc`/source GStreamer di dalam `playbin3`**, bukan oleh kode Rust kita. Server memvalidasi dua header itu + menentang redirect otomatis (agar lease tidak bocor ke host lain).

### 6. Decode → `appsink` → `VideoFrame`

Callback `new-sample` (`playback/engine.rs:109-222`):

1. `pull-sample` → `VideoInfo::from_caps` → `width/height/format`.
2. Hanya `NV12` dan `Rgba` yang diterima, selain itu di-drop (`FlowReturn::Ok` agar pipeline tetap jalan).
3. Hitung `total_bytes`: NV12 = `W*H + ceil(W/2)*2*ceil(H/2)` (≈ 62.5% lebih kecil dari RGBA — ada unit test di `engine.rs:489`); RGBA = `W*H*4`.
4. Ambil `Vec<u8>` dari recycle pool (kap maks 4) atau alokasi baru, lalu:
   - fast path: `memcpy` jika stride == lebar baris dan offset contiguous;
   - slow path: copy per-baris mengikuti `stride[]`/`offset[]` GStreamer.
5. Simpan ke slot `frame` (frame lama dikembalikan ke pool), panggil redraw callback.

PTS buffer (`buffer.pts()`) disimpan ke `last_video_pts` sebagai fallback `position()` saat `query_position` belum tersedia (`engine.rs:366`).

### 7. Render ke layar (wgpu)

`desktop/src/ui/video_surface.rs:406-929` (`VideoPaintSource`):

- `frames.take_frame()` → validasi panjang buffer → (re)create texture jika ukuran/format berubah:
  - NV12 → texture Y (`R8Unorm` W×H) + UV (`Rg8Unorm` W/2×H/2).
  - RGBA → satu texture `Rgba8Unorm`.
- `queue.write_texture()` upload Y/UV/RGBA.
- Render pass letterbox (contain): `scale = min(tw/fw, th/fh)`, background hitam (`Clear(BLACK)`).
- Shader NV12: normalisasi studio-swing Y `[16,235]` / UV `[16,240]`, matriks **BT.601 jika tinggi < 720, BT.709 jika ≥ 720** (`video_surface.rs:774,83`).
- Output ke `target_texture` → `TextureHandle` → `<canvas>` (`video_player.rs:325`).
- Loop 16ms memaksa redraw hanya saat `status == Playing && is_video()` (`ui/mod.rs:318-336`); saat suspend, semua texture/device di-drop (`suspend()`).

### 8. Tick, seek, quality, lifecycle

| Operasi | Lokasi | Catatan |
|---|---|---|
| Poll EOS/Error | `engine.rs:410 poll_event()` + `ui/mod.rs:909` | `Eos → coordinator.ended()` lalu `navigate_queue(forward)`; `Failed(msg) → coordinator.failed()` + banner. Auto-ended juga jika `position >= duration - 0.25`. |
| Position/Duration | `engine.rs:366,375` | `query_position/query_duration`, fallback PTS video. `tick_playback` update via `update_timing()` tiap 100ms. |
| Seek | `engine.rs:342 seek()` | `seek_simple(FLUSH \| KEY_UNIT)`; jika pipeline belum `Paused`, masuk `pending_seek` dan di-flush saat `AsyncDone/StateChanged` (`flush_pending_seek`). |
| Ganti quality | `ui/mod.rs:850 change_quality()` | `coordinator.set_quality()` → `play_media_at(same media, position, was_playing)` = session baru + `open` ulang. |
| Heartbeat lease | `ui/mod.rs:948` tiap 10s | `client.heartbeat(&session)` jika `lease_required`; gagal → `pause + lease_lost()` ("Playback moved to another device"). Selalu kirim `play/pause` report. |
| Stop/cleanup | `engine.rs:307 stop()` + `ui/mod.rs:1065` | `playbin → Null`, headers dibersihkan, `session.take()` lalu `client.release(&session)` (`DELETE api/playback/lease`). `use_drop` di `App` melakukan release terakhir via thread khusus (`ui/mod.rs:354`). |

## File Referensi Cepat

| Lapisan | File |
|---|---|
| Trigger + orkestrasi video | `desktop/src/ui/mod.rs:626 play_media`, `:635 play_media_at` |
| Status/sequence/efek | `desktop/src/playback/coordinator.rs:66 load`, `:58 Effect::CreateSession` |
| Session + URL | `desktop/src/api/endpoints.rs:112 create_playback_session`, `desktop/src/api/client.rs:142 absolute_url`, `desktop/src/api/url.rs:102 join_stream`, `desktop/src/api/endpoint.rs:102` |
| Engine GStreamer | `desktop/src/playback/engine.rs:80 new`, `:259 open`, `:287 play`, `:109 new-sample`, `:226 source-setup` |
| Frame → GPU | `desktop/src/ui/video_surface.rs:378 VideoPaintSource`, `:560 render` |
| Player UI | `desktop/src/ui/views/video_player.rs:100 VideoPlayer`, `:325 canvas`, `desktop/src/ui/views/full_player.rs:18`, `desktop/src/ui/views/shell.rs:163` |
| Spike/debug manual | `desktop/src/bin/video-spike.rs:151 absolute_url`, `:158 open`, `:572 probe_protected_stream` |

## Catatan Beda Audio vs Foto

- **Audio**: jalur session + `playbin3` sama, hanya audio-sink yang bunyi; tidak ada frame video / canvas.
- **Foto**: tidak pakai `playbin3`. `client.photo()` = `create_playback_session` + `GET stream_url` via reqwest + langsung `release()` (`api/endpoints.rs:95`). Bytes → `data:{mime};base64,...` → `<img>`.
