#!/usr/bin/env python3
"""Decode a GStreamer pkg Payload (pbzx) from stdin to a cpio stream on stdout."""

import lzma
import struct
import sys


def read_exact(size: int) -> bytes:
    data = sys.stdin.buffer.read(size)
    if len(data) != size:
        raise ValueError("truncated pbzx payload")
    return data


def main() -> None:
    if read_exact(4) != b"pbzx":
        raise ValueError("invalid pbzx header")
    flags = struct.unpack(">Q", read_exact(8))[0]
    while header := sys.stdin.buffer.read(16):
        if len(header) != 16:
            raise ValueError("truncated pbzx chunk header")
        expected_size, compressed_size = struct.unpack(">QQ", header)
        payload = read_exact(compressed_size)
        decoded = lzma.decompress(payload) if flags & 0x01000000 else payload
        if len(decoded) != expected_size:
            raise ValueError("pbzx chunk size mismatch")
        sys.stdout.buffer.write(decoded)


if __name__ == "__main__":
    try:
        main()
    except ValueError as exc:
        print(f"pbzx: {exc}", file=sys.stderr)
        sys.exit(1)
