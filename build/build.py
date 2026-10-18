#!/usr/bin/env python3
"""Assemble the single-file Bonsai build:
head.html + three.min.js (r147) + logic.js + scene.js -> ~/workspace/your_files/bonsai/index.html
Also copies build/music/ -> <outdir>/music/ and writes music/playlist.json so the
game can play your own tracks (in random order) instead of the generative hum.
"""
import json
import pathlib
import shutil
import sys

root = pathlib.Path(__file__).parent
head = (root / "head.html").read_text()
three = (root / "three.min.js").read_text()
logic = (root / "logic.js").read_text()
scene_js = (root / "scene.js").read_text()

out = (
    head
    + "<script>\n" + three + "\n</script>\n"
    + "<script>\n" + logic + "\n</script>\n"
    + "<script>\n" + scene_js + "\n</script>\n"
    + "</body>\n</html>\n"
)

dest = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else (
    pathlib.Path.home() / "workspace/your_files/bonsai/index.html")
dest.write_text(out)
print(f"wrote {dest} ({len(out)/1024:.0f} KB)")

# music: drop audio files in build/music/, they ship next to index.html
AUDIO_EXTS = {".mp3", ".ogg", ".oga", ".wav", ".m4a", ".aac", ".flac", ".opus", ".webm"}
src_music = root / "music"
dst_music = dest.parent / "music"
dst_music.mkdir(exist_ok=True)
tracks = []
if src_music.is_dir():
    for f in sorted(src_music.iterdir()):
        if f.is_file() and f.suffix.lower() in AUDIO_EXTS:
            shutil.copy2(f, dst_music / f.name)
            tracks.append(f.name)
(dst_music / "playlist.json").write_text(json.dumps({"tracks": tracks}, indent=1) + "\n")
print(f"music: {len(tracks)} track(s) -> {dst_music}")
