"""
render_final.py
Production two-pass render script:
1. Pass 1: Burn 12 drawtext captions onto draft.mp4 -> demo_captioned.mp4
2. Pass 2: Mix 11 voiceovers (vo/s1.mp3 ... vo/s11.mp3) with exact delays & loudnorm,
          mux with demo_captioned.mp4 -> final.mp4
"""

import subprocess
import sys
from pathlib import Path

BASE = Path(r"D:\jev_bridge\artifacts\edit")
VO_DIR = BASE / "vo"
FINAL_OUTPUT = BASE / "final.mp4"
CAPTIONED_TEMP = BASE / "demo_captioned.mp4"

CAPTIONS_SPEC = [
    ("c1.txt",   "white",    0.5,   6.8),
    ("c3.txt",   "white",   15.5,  21.5),
    ("c5a.txt",  "white",   31.0,  44.0),
    ("c5b.txt",  "white",   44.0,  48.8),
    ("c6.txt",   "white",   49.3,  53.2),
    ("c7a.txt",  "0xffd479", 54.0,  59.5),
    ("c7b.txt",  "white",   59.5,  68.0),
    ("c8.txt",   "white",   69.5,  80.0),
    ("c9.txt",   "white",   82.0,  88.3),
    ("c9b.txt",  "white",   89.0,  96.5),
    ("c10.txt",  "white",   98.0, 108.0),
    ("c10b.txt", "white",  111.0, 121.0),
]

AUDIO_SPEC = [
    ("s1.mp3",    800),
    ("s2.mp3",   7500),
    ("s3.mp3",  16000),
    ("s4.mp3",  22500),
    ("s5.mp3",  33000),
    ("s6.mp3",  47500),
    ("s7.mp3",  54500),
    ("s8.mp3",  69500),
    ("s9.mp3",  82000),
    ("s10.mp3", 98000),
    ("s11.mp3", 123000),
]

def clean_text(raw: str) -> str:
    t = raw.strip()
    t = t.replace("\u2013", "-").replace("\u2014", "-")
    t = t.replace("\u2192", "->")
    t = t.replace("\u00b7", "|")
    t = t.replace("'", "")  # prevent single quote from terminating filter string
    t = t.encode("ascii", errors="replace").decode("ascii").replace("?", "-")
    t = t.replace("\\", "\\\\").replace(":", "\\:").replace("%", "\\%")
    return t

def pass1_burn_captions():
    print("\n--- Pass 1: Burning Captions onto Video ---")
    filters = []
    for fn, color, t0, t1 in CAPTIONS_SPEC:
        p = BASE / fn
        if not p.exists():
            continue
        txt = clean_text(p.read_text(encoding="utf-8", errors="replace"))
        filt = (
            f"drawtext=font=Arial Bold:text='{txt}':fontcolor={color}:fontsize=26"
            f":box=1:boxcolor=black@0.55:boxborderw=12:x=(w-tw)/2:y=660"
            f":enable='between(t,{t0},{t1})'"
        )
        filters.append(filt)

    vf = ",".join(filters)
    cmd = [
        "ffmpeg", "-y",
        "-i", str(BASE / "draft.mp4"),
        "-vf", vf,
        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
        str(CAPTIONED_TEMP)
    ]
    res = subprocess.run(cmd)
    if res.returncode != 0:
        print(f"Pass 1 failed with code {res.returncode}")
        sys.exit(res.returncode)
    print("Pass 1 completed successfully.")

def pass2_mix_audio():
    print("\n--- Pass 2: Mixing 11 Voiceovers & Muxing ---")
    cmd = ["ffmpeg", "-y", "-i", str(CAPTIONED_TEMP)]
    for fn, _ in AUDIO_SPEC:
        cmd.extend(["-i", str(VO_DIR / fn)])

    delays = []
    labels = []
    for i, (fn, d_ms) in enumerate(AUDIO_SPEC, start=1):
        delays.append(f"[{i}:a]adelay={d_ms}:all=1[a{i}]")
        labels.append(f"[a{i}]")

    all_labels = "".join(labels)
    filter_complex = ";".join(delays) + f";{all_labels}amix=inputs=11:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad,atrim=0:137.9[aout]"

    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        str(FINAL_OUTPUT),
    ])

    res = subprocess.run(cmd)
    if res.returncode != 0:
        print(f"Pass 2 failed with code {res.returncode}")
        sys.exit(res.returncode)
    print(f"Pass 2 completed successfully.")

def main():
    print("=== render_final.py ===")
    pass1_burn_captions()
    pass2_mix_audio()
    size_mb = FINAL_OUTPUT.stat().st_size / (1024 * 1024)
    print(f"\n Master Render Complete!")
    print(f"Output: {FINAL_OUTPUT} ({size_mb:.2f} MB, 137.9s)")

if __name__ == "__main__":
    main()
