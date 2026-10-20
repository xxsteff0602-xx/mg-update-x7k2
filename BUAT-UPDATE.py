"""Untuk PEMILIK (bukan staf): membuat paket pembaruan.
Pakai:  python BUAT-UPDATE.py "catatan singkat perubahan"
Hasil di folder _rilis : update.zip + version.json + BO-ISI-ID.user.js -> unggah SEMUANYA ke repo GitHub (cabang main, di folder paling atas).
Nomor versi dinaikkan otomatis (app/VERSION)."""
import os, sys, json, zipfile, hashlib

BASE = os.path.dirname(os.path.abspath(__file__))
notes = " ".join(sys.argv[1:]).strip()
vf = os.path.join(BASE, "app", "VERSION")
cur = open(vf, encoding="utf-8").read().strip() if os.path.exists(vf) else "2.0"
parts = cur.split(".")
try: parts[-1] = str(int(parts[-1]) + 1)
except ValueError: parts.append("1")
new = ".".join(parts)
open(vf, "w", encoding="utf-8").write(new)

out = os.path.join(BASE, "_rilis"); os.makedirs(out, exist_ok=True)
zp = os.path.join(out, "update.zip")
n = 0
with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
    for top in ("app", "GOOGLE-SHEET"):
        for root, dirs, files in os.walk(os.path.join(BASE, top)):
            dirs[:] = [d for d in dirs if d not in ("__pycache__", "profile")]
            for f in files:
                if f.endswith(".pyc") or f.endswith(".new"): continue
                full = os.path.join(root, f); z.write(full, os.path.relpath(full, BASE).replace(os.sep, "/")); n += 1
    for f in os.listdir(BASE):
        if f.lower().endswith((".txt", ".bat")) and os.path.isfile(os.path.join(BASE, f)): z.write(os.path.join(BASE, f), f); n += 1
sha = hashlib.sha256(open(zp, "rb").read()).hexdigest()
json.dump({"version": new, "zip": "update.zip", "sha256": sha, "notes": notes}, open(os.path.join(out, "version.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
import shutil; shutil.copy2(os.path.join(BASE, "GOOGLE-SHEET", "BO-ISI-ID.user.js"), os.path.join(out, "BO-ISI-ID.user.js"))
print(f"Versi {cur} -> {new}, {n} file, sha256 {sha[:12]}...")
print("Unggah ketiga file di _rilis (update.zip, version.json, BO-ISI-ID.user.js) ke GitHub (replace file lama).")
