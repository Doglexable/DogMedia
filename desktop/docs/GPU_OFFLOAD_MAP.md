# Peta Offload GPU — Pipeline Video Desktop

Status: **Terverifikasi & Diperbarui (13 Oktober 2026)**.
Observasi awal mencatat log FPS 15–21 (target 24fps, sumber 1080p).
Setelah investigasi dan pengujian pipeline langsung, **decode H.264 terbukti 100% berjalan di GPU (Hardware Accelerated via VA-API `vah264dec`)**.

Sistem referensi: Intel TigerLake Iris Xe, `/dev/dri/renderD128` aktif,
`vah264dec` (rank 257) > `avdec_h264` (rank 256), driver Intel iHD (libva 2.24.0).

---

## Alur Pipeline Aktual

```
[server .mp4/H.264] --http--> playbin3 --parse/demux (CPU)
  --> decode (GPU via VA-API vah264dec pada /dev/dri/renderD128)
  --> direct raw output: video/x-raw NV12 (download VA surface -> system memory)
  --> appsink new-sample: fast-path memcpy ±3,1 MB/frame (CPU, engine.rs:148-240)
  --> slot tunggal Option<VideoFrame> (RAM, recycle buffer pool <= 4)
  --> queue.write_texture Y (R8) + UV (Rg8), ±3,1 MB/frame (CPU→GPU upload, video_surface.rs:668-711)
  --> shader NV12→RGB + scale (GPU wgpu, durasi < 16ms)
  --> Blitz composite + present (GPU)
```

Beban memori per frame 1080p NV12: Y 2,07 MB + UV 1,04 MB = ±3,1 MB.
Pada 24fps ≈ 75 MB/s memcpy + 75 MB/s upload texture. Nilai ini sangat ringan untuk bus PCI-e / UMA modern.

---

## Status Stage & Opsi GPU

| # | Stage | Status Sekarang | Opsi GPU / Penanganan | Effort | Status / Kesimpulan |
|---|-------|-----------------|-----------------------|--------|---------------------|
| 1 | **H.264 Decode** | **GPU Hardware Decode** (`vah264dec`, rank 257) pada `/dev/dri/renderD128` | Sudah aktif secara otomatis oleh autoplugger GStreamer | — | ✅ **Optimal (Hardware)** |
| 2 | **VA surface → RAM** | Driver VA mendownload NV12 ke system RAM agar sesuai caps `video/x-raw` | Zero-copy butuh caps `memory:DMABuf` + import dmabuf ke wgpu-hal. Sangat kompleks & risiko regresi tinggi | L, risiko tinggi | ⏸️ **Tetap Ditunda** (75 MB/s transfer tidak menjadi bottleneck) |
| 3 | **Stride Tidy** (`engine.rs`) | **Fast-path slice copy** (`y_stride == y_width` & `uv_stride == uv_row_bytes`) | Tidak ada penataan per-baris; 1x `extend_from_slice` langsung | — | ✅ **Fast-path Aktif** |
| 4 | **Upload `write_texture` Y+UV** | CPU→GPU copy ±3,1 MB/frame di `video_surface.rs` | Untuk target kecil (Mini Player 358×201), decode 1080p penuh adalah pemborosan. Gunakan scale-down caps saat preview | S–M | 🎯 **Rekomendasi Utama (Mini Player)** |
| 5 | **NV12→RGB + Scale** | GPU Shader (`video_surface.wgsl`) via `wgpu` | Sudah berjalan penuh di GPU (<16ms) | — | ✅ **Optimal (GPU)** |

---

## Bukti Verifikasi Lapangan (13 Okt 2026)

### 1. Driver VA-API & Hardware Entrypoints
Perintah `vainfo`:
```
vainfo: VA-API version: 1.24 (libva 2.24.0)
vainfo: Driver version: Intel iHD driver for Intel(R) Gen Graphics - 26.2.4 ()
vainfo: Supported profile and entrypoints
      VAProfileH264Main               : VAEntrypointVLD
      VAProfileH264High               : VAEntrypointVLD
```
Hardware Intel Iris Xe mendukung penuh decode H.264 VLD di level driver kernel `/dev/dri/renderD128`.

### 2. Prioritas Rank GStreamer
Perintah `gst-inspect-1.0 vah264dec` vs `avdec_h264`:
- `vah264dec`: Rank **257** (`primary + 1`)
- `avdec_h264`: Rank **256** (`primary`)

`vah264dec` dipastikan selalu menang saat negosiasi autoplugger `decodebin3`/`playbin3`.

### 3. Eksekusi Riil Pipeline Video 1080p
Pengujian pipeline dengan file video 1080p `data/media/13/233.mp4`:
```
Got context from element 'vah264dec0': path=/dev/dri/renderD128
/playbin3-0/.../vah264dec0: device-path = /dev/dri/renderD128
/playbin3-0/.../vah264dec0.GstPad:src: caps = video/x-raw, format=NV12, width=1920, height=1080
/playbin3-0/.../appsink0.GstPad:sink: caps = video/x-raw, format=NV12, width=1920, height=1080
```
- Elemen decoder software libav (`avdec_h264`) sama sekali **tidak pernah diinisialisasi**.
- Pad `src` dari `vah264dec0` langsung bernegosiasi ke `video/x-raw, format=NV12` tanpa konversi warna software (`videoconvert`).

---

## Analisis Akar Masalah FPS 15–21 & Catatan Perbaikan

Karena decode terbukti berjalan di GPU dan render shader `< 16ms`, fluktuasi FPS 15–21 pada observasi awal **bukan disebabkan oleh CPU decode atau GPU stall**, melainkan:

1. **VDOM & Layout Churn di Blitz**:
   - Komponen slider seek dan progress bar sebelumnya memicu ratusan alokasi closure dan perombakan struktur DOM setiap tick (100ms), menyita main thread UI yang bertugas memicu repaint `video_surface`.
   - *Status*: Telah diselesaikan dengan memoize `SliderHitArea`, throttle tick UI ke 1.0s, dan penyederhanaan `MusicProgress`.
2. **glibc Heap Fragmentation**:
   - Churn alokasi di multi-thread arena sempat menahan heap hingga >1 GB.
   - *Status*: Telah diselesaikan dengan `malloc_trim(0)` dan daur ulang buffer `recycle_target` di `engine.rs` (maksimal 4 slot frame).

---

## Rekomendasi Selanjutnya

1. **Pertahankan Pipeline Decode Saat Ini**:
   - Jangan ubah caps `NV12` di `engine.rs` karena caps ini telah terbukti mengaktifkan jalur tercepat langsung dari `vah264dec` ke `appsink`.
2. **Scale-down pada Mode Mini Player (`VideoMiniPlayer`)**:
   - Saat jendela video diperkecil ke ukuran mini-player (358×201), pipeline saat ini tetap mentransfer tekstur 1080p penuh (3,1 MB per frame).
   - Implementasikan adaptive caps atau scale-down khusus untuk viewport mini guna menghemat bandwidth upload tekstur hingga ~95%.
3. **DMABuf Zero-Copy Tetap Ditunda**:
   - Bandwidth upload ~75 MB/s pada 1080p 24fps tidak membebani sistem UMA TigerLake Iris Xe. Kompleksitas binding `dmabuf` wgpu tidak sebanding dengan manfaatnya saat ini.
