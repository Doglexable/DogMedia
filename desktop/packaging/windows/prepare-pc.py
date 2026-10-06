#!/usr/bin/env python3
"""Relocate conda-forge Windows pkg-config metadata for cross-compilation."""

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("library", type=Path, help="conda tree/Library directory")
    parser.add_argument("output", type=Path, help="writable pkg-config directory")
    args = parser.parse_args()
    library = args.library.resolve()
    output = args.output.resolve()
    source = library / "lib/pkgconfig"
    for required in (
        library / "include/glib-2.0/glib.h",
        library / "lib/glib-2.0/include/glibconfig.h",
        library / "lib/glib-2.0.lib",
        library / "lib/gobject-2.0.lib",
        library / "lib/gio-2.0.lib",
        library / "lib/gstreamer-1.0.lib",
        source / "gstreamer-1.0.pc",
        source / "gstreamer-video-1.0.pc",
    ):
        if not required.is_file():
            parser.error(f"missing real Windows development file: {required}")

    output.mkdir(parents=True, exist_ok=True)
    for pc in source.glob("*.pc"):
        lines = pc.read_text().splitlines()
        lines = [f"prefix={library}" if line.startswith("prefix=") else line for line in lines]
        (output / pc.name).write_text("\n".join(lines) + "\n")

    # conda's libglib split package has headers and import libraries but no
    # .pc files. These entries point to those actual files, not host libraries.
    for name, requires, import_name in (
        ("glib-2.0", "", "glib-2.0"),
        ("gobject-2.0", "glib-2.0", "gobject-2.0"),
        ("gio-2.0", "gobject-2.0", "gio-2.0"),
        ("gmodule-no-export-2.0", "glib-2.0", "gmodule-2.0"),
    ):
        (output / f"{name}.pc").write_text(
            f"prefix={library}\n"
            "libdir=${prefix}/lib\n"
            "includedir=${prefix}/include\n"
            f"Name: {name}\n"
            "Description: MSVC import library from pinned conda-forge tree\n"
            "Version: 2.90.0\n"
            f"Requires: {requires}\n"
            f"Libs: -L${{libdir}} -l{import_name}\n"
            "Cflags: -I${includedir}/glib-2.0 -I${libdir}/glib-2.0/include\n"
        )


if __name__ == "__main__":
    main()
