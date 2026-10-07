use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProcessMemorySnapshot {
    pub pid: u32,
    pub epoch_secs: u64,
    pub rss_kib: u64,
    pub pss_kib: u64,
    pub private_dirty_kib: u64,
    pub rss_anon_kib: u64,
    pub peak_rss_kib: u64,
    /// `[heap]` Private_Dirty: glibc malloc arena. Fat-but-flat here means
    /// allocator retention/fragmentation, not a Rust heap leak.
    pub heap_dirty_kib: u64,
    /// Anonymous mappings without pathname (excludes heap/stack).
    pub anon_dirty_kib: u64,
    /// File-backed Private_Dirty (executable writable segments, memfd-less).
    pub file_dirty_kib: u64,
    /// DRM/DRI/dmabuf/memfd-style mappings: GPU and zerocopy media buffers.
    pub gpu_dirty_kib: u64,
    /// `/dev/shm` mappings.
    pub shm_dirty_kib: u64,
    /// `[stack]` Private_Dirty.
    pub stack_dirty_kib: u64,
    pub threads: u64,
    pub file_descriptors: u64,
}

fn value_kib(text: &str, key: &str) -> u64 {
    text.lines()
        .find_map(|line| line.strip_prefix(key))
        .and_then(|line| line.split_whitespace().next())
        .and_then(|value| value.parse().ok())
        .unwrap_or_default()
}

fn is_mapping_header(line: &str) -> bool {
    let mut parts = line.split_whitespace();
    match (parts.next(), parts.next()) {
        (Some(addr), Some(perms)) => {
            addr.contains('-')
                && addr
                    .split('-')
                    .all(|half| !half.is_empty() && half.chars().all(|c| c.is_ascii_hexdigit()))
                && perms.chars().count() == 4
        }
        _ => false,
    }
}

fn is_gpu_path(path: &str) -> bool {
    let path = path.to_ascii_lowercase();
    [
        "drm", "dri", "dmabuf", "dma_heap", "dma-buf", "memfd", "ashmem", "gpu", "radeon",
        "amdgpu", "i915", "nouveau", "nvidia",
    ]
    .iter()
    .any(|token| path.contains(token))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SegmentKind {
    Heap,
    Anon,
    File,
    Gpu,
    Shm,
    Stack,
}

fn classify_mapping(pathname: &str) -> SegmentKind {
    if pathname == "[heap]" {
        SegmentKind::Heap
    } else if pathname == "[stack]" || pathname.starts_with("[stack:") {
        SegmentKind::Stack
    } else if pathname.starts_with("/dev/shm") {
        SegmentKind::Shm
    } else if is_gpu_path(pathname) {
        SegmentKind::Gpu
    } else if pathname.starts_with('/') {
        SegmentKind::File
    } else {
        SegmentKind::Anon
    }
}

/// Sum Private_Dirty per segment class from a full `/proc/<pid>/smaps`
/// dump. Returns (heap, anon, file, gpu, shm, stack) in KiB.
fn segment_private_dirty(smaps: &str) -> (u64, u64, u64, u64, u64, u64) {
    let mut kind = SegmentKind::Anon;
    let mut heap = 0_u64;
    let mut anon = 0_u64;
    let mut file = 0_u64;
    let mut gpu = 0_u64;
    let mut shm = 0_u64;
    let mut stack = 0_u64;
    for line in smaps.lines() {
        if is_mapping_header(line) {
            let pathname = line.split_whitespace().nth(5).unwrap_or_default();
            kind = classify_mapping(pathname);
        } else if let Some(rest) = line.strip_prefix("Private_Dirty:") {
            let kib: u64 = rest
                .split_whitespace()
                .next()
                .and_then(|v| v.parse().ok())
                .unwrap_or_default();
            match kind {
                SegmentKind::Heap => heap += kib,
                SegmentKind::Anon => anon += kib,
                SegmentKind::File => file += kib,
                SegmentKind::Gpu => gpu += kib,
                SegmentKind::Shm => shm += kib,
                SegmentKind::Stack => stack += kib,
            }
        }
    }
    (heap, anon, file, gpu, shm, stack)
}

pub fn process_memory_snapshot() -> std::io::Result<ProcessMemorySnapshot> {
    let pid = std::process::id();
    let status = fs::read_to_string(format!("/proc/{pid}/status"))?;
    let rollup = fs::read_to_string(format!("/proc/{pid}/smaps_rollup"))?;
    let file_descriptors = fs::read_dir(format!("/proc/{pid}/fd"))?.count() as u64;
    // Full smaps walk is the expensive part; --memory-watch runs it once
    // per minute, and --memory-snapshot runs it once on demand.
    let (heap, anon, file, gpu, shm, stack) = fs::read_to_string(format!("/proc/{pid}/smaps"))
        .map(|smaps| segment_private_dirty(&smaps))
        .unwrap_or_default();
    let epoch_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default();
    Ok(ProcessMemorySnapshot {
        pid,
        epoch_secs,
        rss_kib: value_kib(&status, "VmRSS:"),
        pss_kib: value_kib(&rollup, "Pss:"),
        private_dirty_kib: value_kib(&rollup, "Private_Dirty:"),
        rss_anon_kib: value_kib(&status, "RssAnon:"),
        peak_rss_kib: value_kib(&status, "VmHWM:"),
        heap_dirty_kib: heap,
        anon_dirty_kib: anon,
        file_dirty_kib: file,
        gpu_dirty_kib: gpu,
        shm_dirty_kib: shm,
        stack_dirty_kib: stack,
        threads: value_kib(&status, "Threads:"),
        file_descriptors,
    })
}

impl std::fmt::Display for ProcessMemorySnapshot {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "pid={} ts={} rss_kib={} pss_kib={} private_dirty_kib={} rss_anon_kib={} peak_rss_kib={} heap_kib={} anon_kib={} file_kib={} gpu_kib={} shm_kib={} stack_kib={} threads={} fds={}",
            self.pid,
            self.epoch_secs,
            self.rss_kib,
            self.pss_kib,
            self.private_dirty_kib,
            self.rss_anon_kib,
            self.peak_rss_kib,
            self.heap_dirty_kib,
            self.anon_dirty_kib,
            self.file_dirty_kib,
            self.gpu_dirty_kib,
            self.shm_dirty_kib,
            self.stack_dirty_kib,
            self.threads,
            self.file_descriptors
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ProcessMemorySnapshot, SegmentKind, classify_mapping, is_mapping_header,
        segment_private_dirty,
    };

    #[test]
    fn snapshot_format_is_shell_friendly() {
        let snapshot = ProcessMemorySnapshot {
            pid: 42,
            epoch_secs: 1_700_000_000,
            rss_kib: 100,
            pss_kib: 90,
            private_dirty_kib: 80,
            rss_anon_kib: 70,
            peak_rss_kib: 110,
            heap_dirty_kib: 40,
            anon_dirty_kib: 20,
            file_dirty_kib: 10,
            gpu_dirty_kib: 5,
            shm_dirty_kib: 3,
            stack_dirty_kib: 2,
            threads: 3,
            file_descriptors: 8,
        };
        assert_eq!(
            snapshot.to_string(),
            "pid=42 ts=1700000000 rss_kib=100 pss_kib=90 private_dirty_kib=80 rss_anon_kib=70 peak_rss_kib=110 heap_kib=40 anon_kib=20 file_kib=10 gpu_kib=5 shm_kib=3 stack_kib=2 threads=3 fds=8"
        );
    }

    #[test]
    fn mapping_headers_and_classes_are_detected() {
        assert!(is_mapping_header(
            "55a1b2c3d000-55a1b2c3e000 rw-p 00000000 00:00 0  [heap]"
        ));
        assert!(!is_mapping_header("Private_Dirty:        12 kB"));
        assert_eq!(classify_mapping("[heap]"), SegmentKind::Heap);
        assert_eq!(classify_mapping("[stack]"), SegmentKind::Stack);
        assert_eq!(classify_mapping("/dev/shm/pipewire-0"), SegmentKind::Shm);
        assert_eq!(classify_mapping("/dev/dri/card0"), SegmentKind::Gpu);
        assert_eq!(
            classify_mapping("memfd:JSGCHeap (deleted)"),
            SegmentKind::Gpu
        );
        assert_eq!(classify_mapping("/usr/lib/libfoo.so"), SegmentKind::File);
        assert_eq!(classify_mapping(""), SegmentKind::Anon);
    }

    #[test]
    fn segments_sum_private_dirty_by_class() {
        let smaps = "\
55a10000-55a11000 rw-p 00000000 00:00 0  [heap]\n\
Private_Dirty:        40 kB\n\
7f000000-7f001000 rw-p 00000000 00:00 0\n\
Private_Dirty:        20 kB\n\
7f001000-7f002000 rw-p 00000000 00:00 0  /dev/dri/card0\n\
Private_Dirty:         5 kB\n\
";
        assert_eq!(segment_private_dirty(smaps), (40, 20, 0, 5, 0, 0));
    }

    #[test]
    fn live_process_segments_reconcile_with_rollup() {
        let snapshot = super::process_memory_snapshot().expect("self snapshot");
        let segments = snapshot.heap_dirty_kib
            + snapshot.anon_dirty_kib
            + snapshot.file_dirty_kib
            + snapshot.gpu_dirty_kib
            + snapshot.shm_dirty_kib
            + snapshot.stack_dirty_kib;
        let rollup = snapshot.private_dirty_kib;
        let drift = segments.abs_diff(rollup);
        // Both reads race the live process (and sibling tests allocating in
        // parallel); this is a parser smoke test, not a precision check.
        assert!(
            drift <= rollup / 20 + 32_768,
            "segments={segments} rollup={rollup}"
        );
    }
}
