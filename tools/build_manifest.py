#!/usr/bin/env python3
"""Regenerate manifest.json from plays/*/play.json.

Each play folder under plays/ must contain:
  play.json     metadata (id, name, version, author, description, tags, source, license)
  firmware.bin  app image flashed at 0x10000 (factory partition)
  cover.jpg     cover image shown on the site

Run:  python3 tools/build_manifest.py
"""
import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLASH_ADDRESS = 0x10000
FACTORY_SIZE = 0x300000  # shipping layout: factory partition is 3 MB


def main() -> int:
    plays = []
    plays_dir = os.path.join(ROOT, "plays")
    for entry in sorted(os.listdir(plays_dir)):
        pdir = os.path.join(plays_dir, entry)
        meta_path = os.path.join(pdir, "play.json")
        if not os.path.isdir(pdir) or not os.path.exists(meta_path):
            continue
        meta = json.load(open(meta_path, encoding="utf-8"))
        fw_path = os.path.join(pdir, "firmware.bin")
        fw = open(fw_path, "rb").read()
        if fw[0] != 0xE9:
            print(f"ERROR: {entry}/firmware.bin does not start with ESP image magic 0xE9")
            return 1
        if len(fw) > FACTORY_SIZE:
            print(f"ERROR: {entry}/firmware.bin is {len(fw)} bytes, exceeds 3 MB factory partition")
            return 1
        meta.update({
            "firmware": f"plays/{entry}/firmware.bin",
            "cover": f"plays/{entry}/cover.jpg",
            "address": FLASH_ADDRESS,
            "size": len(fw),
            "sha256": hashlib.sha256(fw).hexdigest(),
        })
        plays.append(meta)
        print(f"ok: {entry} ({len(fw)} bytes)")
    manifest = {
        "name": "AI Passport 玩法库",
        "device": "FoloToy AI Passport (ESP32-C3)",
        "plays": plays,
    }
    out = os.path.join(ROOT, "manifest.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"wrote {out} with {len(plays)} plays")
    return 0


if __name__ == "__main__":
    sys.exit(main())
