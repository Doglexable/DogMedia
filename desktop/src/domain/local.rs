use std::{
    fs, io,
    path::{Path, PathBuf},
};

const MAX_SCAN_DEPTH: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalKind {
    Audio,
    Video,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LocalTrack {
    pub path: PathBuf,
    pub title: String,
    pub kind: LocalKind,
    pub duration: Option<f64>,
}

impl LocalTrack {
    fn from_path(path: PathBuf) -> Option<Self> {
        let extension = path.extension()?.to_str()?.to_ascii_lowercase();
        let kind = match extension.as_str() {
            "mp3" | "ogg" | "opus" | "flac" | "wav" | "m4a" | "aac" => LocalKind::Audio,
            "mp4" | "mkv" | "webm" | "mov" | "avi" => LocalKind::Video,
            _ => return None,
        };
        let title = path.file_stem()?.to_string_lossy().into_owned();
        Some(Self {
            path,
            title,
            kind,
            duration: None,
        })
    }
}

pub fn scan_local_folder(root: &Path) -> io::Result<Vec<LocalTrack>> {
    let metadata = fs::symlink_metadata(root)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Choose a readable folder",
        ));
    }
    let mut tracks = Vec::new();
    walk(root, 0, &mut tracks)?;
    Ok(tracks)
}

fn walk(folder: &Path, depth: usize, tracks: &mut Vec<LocalTrack>) -> io::Result<()> {
    let mut directories = Vec::new();
    let mut files = Vec::new();
    for entry in fs::read_dir(folder)? {
        let Ok(entry) = entry else { continue };
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            directories.push(entry);
        } else if kind.is_file() {
            files.push(entry);
        }
    }
    directories.sort_by_key(fs::DirEntry::file_name);
    files.sort_by_key(fs::DirEntry::file_name);
    if depth < MAX_SCAN_DEPTH {
        for entry in directories {
            // A child may disappear or become unreadable during the scan.
            let _ = walk(&entry.path(), depth + 1, tracks);
        }
    }
    for entry in files {
        if let Some(track) = LocalTrack::from_path(entry.path()) {
            tracks.push(track);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_scan_filters_extensions_and_uses_stem_titles() {
        let root = tempfile::tempdir().unwrap();
        for name in ["Song.FLAC", "film.mkv", "photo.jpg", "notes.txt"] {
            fs::write(root.path().join(name), []).unwrap();
        }
        let tracks = scan_local_folder(root.path()).unwrap();
        assert_eq!(
            tracks
                .iter()
                .map(|item| item.title.as_str())
                .collect::<Vec<_>>(),
            ["Song", "film"]
        );
        assert_eq!(
            tracks.iter().map(|item| item.kind).collect::<Vec<_>>(),
            [LocalKind::Audio, LocalKind::Video]
        );
    }

    #[test]
    fn local_scan_visits_sorted_subfolders_before_files_without_following_links() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("z")).unwrap();
        fs::create_dir(root.path().join("a")).unwrap();
        fs::write(root.path().join("root.mp3"), []).unwrap();
        fs::write(root.path().join("z").join("last.mp3"), []).unwrap();
        fs::write(root.path().join("a").join("first.mp3"), []).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.path().join("a"), root.path().join("loop")).unwrap();
        let tracks = scan_local_folder(root.path()).unwrap();
        assert_eq!(
            tracks
                .iter()
                .map(|item| item.title.as_str())
                .collect::<Vec<_>>(),
            ["first", "last", "root"]
        );
    }

    #[test]
    fn local_scan_skips_unreadable_children_and_caps_depth() {
        let root = tempfile::tempdir().unwrap();
        let mut deep = root.path().to_path_buf();
        for _ in 0..=MAX_SCAN_DEPTH + 1 {
            deep = deep.join("child");
            fs::create_dir(&deep).unwrap();
        }
        fs::write(deep.join("too-deep.mp3"), []).unwrap();
        fs::write(root.path().join("visible.mp3"), []).unwrap();
        assert_eq!(scan_local_folder(root.path()).unwrap().len(), 1);
    }
}
