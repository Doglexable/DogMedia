#!/usr/bin/env python3
"""Stage the verified conda-forge runtime without build-only files."""

import argparse
import hashlib
from pathlib import Path
import shutil


# These versioned FFmpeg 8 DLLs belong to the GPL conda package. gstlibav.dll
# imports FFmpeg 9 instead; no other staged plugin imports this older family.
FFMPEG8_DLLS = {
    "avcodec-62.dll", "avdevice-62.dll", "avfilter-11.dll",
    "avformat-62.dll", "avutil-60.dll", "swresample-6.dll",
    "swscale-9.dll",
}
EXCLUDE_DLLS = FFMPEG8_DLLS | {"pixbufloader-tiff.dll"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("library", type=Path)
    parser.add_argument("stage", type=Path)
    args = parser.parse_args()
    library = args.library.resolve()
    stage = args.stage.resolve()
    if not (library / "bin/gstreamer-1.0-0.dll").is_file():
        parser.error("GStreamer runtime DLL missing from conda tree")
    for name in ("gstd3d11.dll", "gstlibav.dll"):
        if not (library / "lib/gstreamer-1.0" / name).is_file():
            parser.error(f"H.264 plugin missing: {name}")
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)

    for source in library.rglob("*.dll"):
        if source.name.lower() in EXCLUDE_DLLS:
            continue
        relative = source.relative_to(library)
        # Windows resolves ordinary DLL imports beside Dogmedia.exe. Keep
        # GStreamer plugins in their plugin directory for the registry scan.
        destination = stage / (source.name if relative.parts[0] == "bin" else relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)

    for name in ("share", "etc"):
        source = library / name
        if source.is_dir():
            shutil.copytree(source, stage / name)
    # The source tree also contains FFmpeg 8 GPL documentation/examples from
    # its dependency-solving round. The staged decoder uses FFmpeg 9.
    ffmpeg_share = stage / "share/ffmpeg"
    if ffmpeg_share.exists():
        shutil.rmtree(ffmpeg_share)
    scanner = library / "libexec/gstreamer-1.0/gst-plugin-scanner.exe"
    if scanner.is_file():
        destination = stage / "libexec/gstreamer-1.0/gst-plugin-scanner.exe"
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(scanner, destination)

    dlls = sorted(stage.rglob("*.dll"))
    manifest = stage / "RUNTIME-DLL-SHA256.txt"
    manifest.write_text("".join(
        f"{sha256(path)}  {path.relative_to(stage).as_posix()}\n"
        for path in dlls
    ))
    print(f"Staged {len(dlls)} DLLs in {stage}")


if __name__ == "__main__":
    main()
