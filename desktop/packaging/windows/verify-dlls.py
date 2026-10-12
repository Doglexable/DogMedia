#!/usr/bin/env python3
"""Check imports of staged Windows DLLs against bundled and system DLLs."""
import collections
import os
import sys

import pefile

if len(sys.argv) != 2:
    raise SystemExit("usage: verify-dlls.py STAGE_DIR")
BASE = sys.argv[1]
SYSTEM = {
    "kernel32.dll", "user32.dll", "gdi32.dll", "advapi32.dll",
    "ole32.dll", "oleaut32.dll", "shell32.dll", "msvcrt.dll",
    "msvcp140.dll", "msvcp140_1.dll", "msvcp140_2.dll",
    "vcruntime140.dll", "vcruntime140_1.dll", "concrt140.dll",
    "vcomp140.dll", "ws2_32.dll", "winmm.dll", "shlwapi.dll",
    "comdlg32.dll", "imm32.dll", "opengl32.dll", "d3d11.dll",
    "dxgi.dll", "d3dcompiler_47.dll", "mfplat.dll", "mf.dll",
    "mfuuid.dll", "propsys.dll", "dwmapi.dll", "uxtheme.dll",
    "crypt32.dll", "bcrypt.dll", "ncrypt.dll", "sechost.dll", "secur32.dll",
    "rpcrt4.dll", "combase.dll", "cfgmgr32.dll", "hid.dll",
    "setupapi.dll", "avrt.dll", "ksuser.dll", "mfreadwrite.dll",
    "mferror.dll", "d3d9.dll", "glu32.dll", "d2d1.dll",
    "dwrite.dll", "dsound.dll", "iphlpapi.dll", "mmdevapi.dll",
    "msimg32.dll", "avicap32.dll", "ntdll.dll", "dnsapi.dll",
    "bcryptprimitives.dll", "usp10.dll",
    "api-ms-win-crt-heap-l1-1-0.dll",
}

have = set()
targets = []
for dp, _dn, fn in os.walk(BASE):
    for f in fn:
        if f.lower().endswith(".dll"):
            have.add(f.lower())
        if f.lower().endswith((".dll", ".exe")):
            targets.append(os.path.join(dp, f))

need: collections.Counter[str] = collections.Counter()
parse_fail = []
for p in targets:
    try:
        pe = pefile.PE(p)
    except Exception:
        parse_fail.append(p)
        continue
    for e in getattr(pe, "DIRECTORY_ENTRY_IMPORT", []) or []:
        need[e.dll.decode().lower()] += 1
    pe.close()

missing = sorted(
    d for d in need
    if d not in have and d not in SYSTEM and not d.startswith("api-ms-win-")
)
print("total dlls:", len(have), "| missing:", len(missing))
for p in parse_fail:
    print("PARSE_FAIL", p)
for d in missing:
    print(" ", d, need[d])
if missing or parse_fail:
    raise SystemExit(1)
