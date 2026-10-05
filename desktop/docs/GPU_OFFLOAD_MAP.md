# Peta Offload GPU — Pipeline Video Desktop

Status: observasi dari log FPS 15–21 (target 24fps, sumber 1080p).
GStreamer tidak drop (`scheduled in time`), tidak ada slow-path stride,
render wgpu <16ms. Sisa tersangka: decode di CPU dan/atau copy CPU→GPU.

Sistem referensi: Intel TigerLake Iris Xe, `/dev/dri/renderD128` ada,
`vah264dec` (rank 257) > `avdec_h264` (rank 256), plugin `nvcodec`/`v4l2codecs` ada.

## Alur saat ini

```
[server .mp4/H.264] --http--> playbin3 --parse/demux (CPU)
  --> decode (VA-API?/CPU? belum pasti, lihat §1)
  --> videoconvert ke NV12/RGBA system memory (CPU)
  --> appsink new-sample: memcpy ±3 MB/frame (CPU, engine.rs:109-231)
  --> slot tunggal Option<VideoFrame> (RAM)
  --> queue.write_texture Y + UV, ±3 MB/frame (CPU→GPU copy, video_surface.rs:658-720)
  --> shader NV12→RGB + scale (GPU, sudah benar)
  --> Blitz composite + present (GPU, sudah benar)
```

Beban CPU per frame 1080p NV12: Y 2,07 MB + UV 1,04 MB = ±3,1 MB.
Pada 24fps ≈ 75 MB/s memcpy + 75 MB/s upload. Masih wajar untuk CPU modern,
tapi digabung decode software H.264 1080p bisa menjenuhkan satu core.

## Stage yang masih CPU dan opsi GPU-nya

| # | Stage | Sekarang | Opsi GPU | Effort | Gain harapan |
|---|-------|----------|----------|--------|--------------|
| 1 | H.264 decode | Belum pasti; `playbin3` + caps `video/x-raw` (`engine.rs:95-107`) membiarkan auto-pilih. Kalau VA gagal init → jatuh ke `avdec_h264` (CPU) | Pastikan `vah264dec` dipakai; fallback eksplisit per-rank. Tetap output system memory (download VA→RAM tidak hilang, tapi decode-nya GPU) | S — verifikasi + force-rank bila perlu | Besar bila selama ini CPU decode; nol bila sudah VA |
| 2 | `videoconvert` + download VA surface → RAM | CPU (implisit di playbin agar cocok caps appsink) | Tidak ada jalan murah selama appsink minta `video/x-raw` system memory. Zero-copy butuh caps `memory:DMABuf` + import dmabuf ke wgpu — kompleks (butuh `wgpu-hal` interop, sinkronisasi dmabuf, fallback). Ditunda | L, risiko tinggi | Sangat besar (hilang 75 MB/s copy), tapi jangan dikerjakan dulu |
| 3 | Stride tidy di `new-sample` (`engine.rs:156-205`) | CPU per-baris saat stride ≠ width. Log kita menunjukkan fast-path (tidak kena), jadi saat ini bukan masalah | Kirim stride apa adanya + `bytes_per_row = stride` di `write_texture`. Hemat CPU tidy, ukuran upload tetap sama | M (ubah `VideoFrame` + validasi + upload path) | Kecil–sedang; hanya menolong bila slow-path sering |
| 4 | Upload `write_texture` Y+UV tiap frame | CPU→GPU copy ±3,1 MB/frame, tidak bisa dihindari tanpa dmabuf (§2) | Perkecil yang diupload: upload sekali saat `frame_size` sama? Tidak bisa — isi berubah tiap frame. Yang realistis: turunkan resolusi decode via `videoscale` + caps `width/height` untuk target kecil (358×201 tidak butuh decode 1080p) | S–M | Sedang untuk mode thumbnail/kecil; nol untuk fullscreen |
| 5 | NV12→RGB + scale + composite | Sudah GPU (shader + Blitz). Benar, jangan diubah | — | — | — |

## Verifikasi tiap stage (jalankan satu per satu)

### 1. Decoder apa yang benar-benar dipakai

```bash
GST_DEBUG="decodebin3:4" cargo run --release 2>&1 | grep -iE "vah264|avdec|nvdec|v4l2h264|selected|autoplug" | head -n 20
# atau non-debug, paksa cek jejeran decodebin:
GST_DEBUG="GST_ELEMENT_FACTORY:3" cargo run --release 2>&1 | grep -iE "vah264dec|avdec_h264" | head -n 10
```

- Ada `vah264dec` → decode sudah GPU. Lanjut ke §4 (beban upload) dan counter `produced vs uploaded`.
- Ada `avdec_h264` → selama ini CPU decode. Coba paksa VA:

```bash
# Cek VA driver dulu:
vainfo 2>&1 | head -n 15
ls /dev/dri
```

Kalau `vainfo` OK tapi playbin tetap pilih `avdec_h264`, kemungkinan caps
`video/x-raw, format NV12/RGBA` + `videoconvert` membuat autoplugger
menilai jalur CPU lebih murah. Opsi (berurutan, satu per satu):

a. Sempitkan caps agar ramah VA (`engine.rs:101`): minta `NV12` saja dulu,
   singkirkan `RGBA` dari daftar agar tidak ada jalur konversi ekstra.
b. Set env rank agar VA menang mutlak saat eksperimen:
   `GST_PLUGIN_FEATURE_RANK=vah264dec:300` (jangan di-commit, hanya diagnosis).
c. Kalau tetap CPU → cek sandbox/flatpak tidak meneruskan `/dev/dri`
   (`--device=dri`).

### 2. Beban upload CPU→GPU (tanpa ubah kode)

Gunakan counter yang sudah ada (`produced_window` vs `render_calls_window` vs `fps`):

```bash
cargo run --release 2>&1 | grep "upload FPS"
```

- `produced≈24, fps≈18` → konsumen kalah (upload+scale). Lanjut §4.
- `produced≈18, fps≈18` → produsen (decode/jaringan) yang lambat. Kembali §1.

### 3. Uji cepat: apakah 1080p decode yang berat?

Putar file 720p atau batasi caps decode ke 720p sementara dan bandingkan FPS.
Kalau 720p langsung 24fps sedangkan 1080p 17–18fps → decode/upload-bound,
bukan bug redraw. (Uji ini tidak di-commit.)

## Rekomendasi urutan (murah → mahal)

1. **Pastikan VA-API dipakai** (§1). Tanpa ubah pipeline, hanya verifikasi +
   rank/caps. Potensi gain terbesar bila selama ini `avdec_h264`.
2. **Decode scale-down untuk target kecil** (§4): kalau panel hanya 358×201,
   decode 1080p lalu downscale di GPU adalah pemborosan. Tambahkan
   `videoscale` + caps max-width di jalur preview (bukan fullscreen).
3. **Stride passthrough** (§3): kerjakan hanya bila log `slow-path` muncul
   berulang. Saat ini tidak muncul → tunda.
4. **DMABuf zero-copy** (§2): proyek tersendiri (mingguan, butuh riset
   `wgpu-hal` + `gst-gl`/`gst-dmabuf`). Jangan mulai sebelum 1–3 terbukti
   tidak cukup.

## Yang eksplisit tidak disarankan

- `sync=false` di appsink: mematikan A/V sync, video lari dari audio.
  Tetap `sync=true` + `max-buffers=4` (sudah diterapkan di `engine.rs:95-102`).
- Queue frame besar di RAM (mis. 8 frame × 3 MB): hanya menunda drop,
  menambah latensi, tidak menaikkan throughput sosten.
- `max-buffers` > 8: menutupi jitter lebih lama tapi latensi naik dan
  memori GStreamer membengkak; 4 sudah cukup untuk konsumen ~60 Hz.
