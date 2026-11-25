#!/usr/bin/env python3
"""Smoke test pembelajaran: materi video dan PDF berurutan dengan progres per siswa.

Membuat datanya sendiri. Butuh admin sdn-1 (admin@sdn1.sch.id / rahasia-123).

  python3 scripts/smoke_pembelajaran.py http://localhost:8080
"""

import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8080"
PASSED = 0


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw.decode(errors="replace")


def upload(token, material_id, filename, data, mime):
    boundary = uuid.uuid4().hex
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {mime}\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{BASE}/api/lms/materials/{material_id}/files", data=body, method="POST")
    req.add_header("content-type", f"multipart/form-data; boundary={boundary}")
    req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def make_pdf(pages):
    """PDF minimal yang valid dengan jumlah halaman tertentu."""
    objs = []
    kids = " ".join(f"{3 + i * 2} 0 R" for i in range(pages))
    objs.append("<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>")
    for i in range(pages):
        content = f"BT /F1 24 Tf 60 150 Td (Halaman {i + 1}) Tj ET"
        objs.append(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] "
            f"/Resources << /Font << /F1 {3 + pages * 2} 0 R >> >> /Contents {4 + i * 2} 0 R >>"
        )
        objs.append(f"<< /Length {len(content)} >>\nstream\n{content}\nendstream")
    objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def check(label, cond, detail=""):
    global PASSED
    if not cond:
        print(f"GAGAL: {label} {detail}")
        sys.exit(1)
    PASSED += 1
    print(f"ok    {label}")


def expect(label, got, want):
    status, payload = got
    check(f"{label} (HTTP {status})", status == want, f"— harapan {want}, body: {str(payload)[:300]}")
    return payload


def login(email, password):
    status, payload = call("POST", "/api/auth/login", body={"school_slug": "sdn-1", "email": email, "password": password})
    assert status == 200, payload
    return payload["token"]


tag = datetime.now().strftime("%H%M%S")
admin = login("admin@sdn1.sch.id", "rahasia-123")

years = expect("tahun ajaran", call("GET", "/api/academic-years", admin), 200)
if not any(y["is_active"] for y in years):
    y = expect("buat tahun ajaran", call("POST", "/api/academic-years", admin, {"name": "2026/2027", "starts_on": "2026-07-01", "ends_on": "2027-06-30"}), 200)
    expect("aktifkan tahun ajaran", call("POST", f"/api/academic-years/{y['id']}/activate", admin), 200)

subj = expect("mapel", call("POST", "/api/subjects", admin, {"code": f"PB{tag}", "name": f"Pembelajaran {tag}"}), 200)
guru_email = f"pbguru{tag}@sdn1.sch.id"
guru = expect("guru", call("POST", "/api/users", admin, {"name": "Guru PB", "email": guru_email, "password": "guru-pass-1", "role": "guru"}), 200)
guru_token = login(guru_email, "guru-pass-1")
kelas = expect("kelas", call("POST", "/api/classes", admin, {"name": f"PB-{tag}", "grade_level": 7}), 200)
asg = expect("penugasan", call("POST", "/api/assignments", admin, {"class_id": kelas["id"], "subject_id": subj["id"], "teacher_id": guru["id"]}), 200)
room = asg["id"]

students = {}
for label in ("a", "luar"):
    st = expect(f"siswa {label}", call("POST", "/api/students", admin, {"nis": f"P{label}{tag}", "name": f"Siswa PB {label}", "status": "aktif"}), 200)
    email = f"pb{label}{tag}@sdn1.sch.id"
    expect(f"akun siswa {label}", call("POST", f"/api/students/{st['id']}/account", admin, {"email": email, "password": "siswa-pass-1"}), 200)
    students[label] = login(email, "siswa-pass-1")
    if label == "a":
        expect("masuk rombel", call("POST", f"/api/classes/{kelas['id']}/students", admin, {"student_ids": [st["id"]]}), 200)
    else:
        student_luar = st

# ---------- Materi: PDF 3 halaman dan video ----------
pdf_mat = expect("materi PDF", call("POST", f"/api/lms/rooms/{room}/materials", guru_token, {"title": f"Modul {tag}"}), 200)
status, up = upload(guru_token, pdf_mat["id"], "modul.pdf", make_pdf(3), "application/pdf")
check("unggah PDF 3 halaman", status == 200, str(up)[:200])
txt_mat = expect("materi teks", call("POST", f"/api/lms/rooms/{room}/materials", guru_token, {"title": f"Teks {tag}", "body": "bacaan"}), 200)
status, _ = upload(guru_token, txt_mat["id"], "bukan.pdf", b"ini bukan pdf sungguhan", "application/pdf")
check("PDF palsu ditolak", status >= 400, str(status))
vid_mat = expect("materi video", call("POST", f"/api/lms/rooms/{room}/materials", guru_token, {"title": f"Video {tag}", "youtube_url": "https://youtu.be/dQw4w9WgXcQ"}), 200)

mats = expect("daftar materi", call("GET", f"/api/lms/rooms/{room}/materials", guru_token), 200)
pdf_file = next(m for m in mats if m["id"] == pdf_mat["id"])["files"][0]["id"]

# ---------- Membuat pembelajaran ----------
items = [{"kind": "video", "material_id": vid_mat["id"]}, {"kind": "pdf", "material_id": pdf_mat["id"], "file_id": pdf_file}]
lesson = expect("buat pembelajaran", call("POST", f"/api/lms/rooms/{room}/lessons", guru_token, {"title": f"Bab 1 {tag}", "items": items}), 200)
check("pembelajaran punya dua item berurutan", len(lesson["items"]) == 2 and lesson["items"][0]["position"] == 1, str(lesson)[:200])
expect("pembelajaran kosong ditolak", call("POST", f"/api/lms/rooms/{room}/lessons", guru_token, {"title": "X", "items": []}), 422)
expect("item PDF dari materi lain ditolak", call("POST", f"/api/lms/rooms/{room}/lessons", guru_token, {"title": "X", "items": [{"kind": "pdf", "material_id": txt_mat["id"], "file_id": pdf_file}]}), 422)
expect("item video dari materi teks ditolak", call("POST", f"/api/lms/rooms/{room}/lessons", guru_token, {"title": "X", "items": [{"kind": "video", "material_id": txt_mat["id"]}]}), 422)

# ---------- Siswa: progres PDF per halaman ----------
sa = students["a"]
lid = lesson["id"]
det = expect("detail pembelajaran siswa", call("GET", f"/api/lms/lessons/{lid}", sa), 200)
check("awal belum selesai dan 0%", det["completed"] is False and det["percent"] == 0, str(det)[:200])
pdf_path = f"/api/lms/files/{pdf_file}/pdf-progress"
p1 = expect("PDF halaman 1 dibuka", call("POST", pdf_path, sa, {"total_pages": 3, "pages": [1]}), 200)
check("1 dari 3 halaman = 33%", p1["viewed_pages"] == 1 and p1["percent"] == 33 and p1["completed"] is False, str(p1))
p1b = expect("halaman 1 lagi tidak dihitung dua kali", call("POST", pdf_path, sa, {"total_pages": 3, "pages": [1]}), 200)
check("tetap 1 halaman", p1b["viewed_pages"] == 1, str(p1b))
expect("nomor halaman di luar jumlah ditolak", call("POST", pdf_path, sa, {"total_pages": 3, "pages": [4]}), 422)
expect("jumlah halaman berubah ditolak", call("POST", pdf_path, sa, {"total_pages": 5, "pages": [2]}), 409)
p3 = expect("halaman 2 dan 3 dibuka", call("POST", pdf_path, sa, {"total_pages": 3, "pages": [2, 3]}), 200)
check("semua halaman dibuka = selesai", p3["completed"] is True and p3["percent"] == 100, str(p3))
expect("progres PDF sendiri", call("GET", pdf_path, sa), 200)

# ---------- Siswa: video sampai habis (waktu nyata, durasi 3 detik) ----------
vpath = f"/api/lms/materials/{vid_mat['id']}/progress"
expect("video heartbeat awal", call("POST", vpath, sa, {"position": 0, "duration": 3}), 200)
for pos in (1, 2, 3):
    time.sleep(1)
    call("POST", vpath, sa, {"position": pos, "duration": 3})

det = expect("detail setelah video dan PDF selesai", call("GET", f"/api/lms/lessons/{lid}", sa), 200)
check("pembelajaran selesai 100%", det["completed"] is True and det["percent"] == 100, str(det)[:300])
check("setiap item menunjukkan progresnya", all(i["progress"]["completed"] for i in det["items"]), str(det)[:300])

# ---------- Hak akses ----------
expect("siswa di luar kelas tidak bisa melihat pembelajaran", call("GET", f"/api/lms/lessons/{lid}", students["luar"]), 403)
expect("siswa di luar kelas tidak bisa melapor PDF", call("POST", pdf_path, students["luar"], {"total_pages": 3, "pages": [1]}), 403)
expect("guru tidak bisa melapor PDF", call("POST", pdf_path, guru_token, {"total_pages": 3, "pages": [1]}), 403)
gdet = expect("detail untuk guru", call("GET", f"/api/lms/lessons/{lid}", guru_token), 200)
check("guru tidak melihat progres siswa", gdet["completed"] is None and all(i["progress"] is None for i in gdet["items"]), str(gdet)[:200])
expect("siswa tidak bisa menghapus pembelajaran", call("DELETE", f"/api/lms/lessons/{lid}", sa), 403)
expect("guru menghapus pembelajaran", call("DELETE", f"/api/lms/lessons/{lid}", guru_token), 200)
expect("pembelajaran terhapus", call("GET", f"/api/lms/lessons/{lid}", guru_token), 404)

print(f"\nSEMUA LULUS: {PASSED} pemeriksaan")
