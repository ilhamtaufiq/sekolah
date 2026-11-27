#!/usr/bin/env python3
"""Smoke test sikap, ekstrakurikuler, dan ketuntasan tujuan di rapor.

Prasyarat: sekolah 'sdn-1' dengan admin admin@sdn1.sch.id / rahasia-123 sudah dibuat.
Skrip membuat data uji sendiri. Jalankan hanya pada database uji.

  python3 scripts/smoke_rapor_sikap.py http://localhost:8080

Isi PDF raport diperiksa dengan pdftotext bila terpasang; bila tidak, bagian itu dilewati.
"""

import json
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8080"
PASSED = 0
SKIPPED = []


def call(method, path, token=None, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            payload = r.read()
            ctype = r.headers.get("content-type", "")
            if raw or "pdf" in ctype:
                return r.status, payload
            return r.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload)
        except json.JSONDecodeError:
            return e.code, payload.decode(errors="replace")


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


def pdf_text(pdf):
    """Teks PDF dengan spasi dirapikan. None bila pdftotext tidak terpasang."""
    if shutil.which("pdftotext") is None:
        return None
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(pdf)
        f.flush()
        out = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, text=True, check=True)
    return " ".join(out.stdout.split())


today = date.today()
tag = datetime.now().strftime("%H%M%S") + uuid.uuid4().hex[:4]
admin = login("admin@sdn1.sch.id", "rahasia-123")

# ---------- Data dasar ----------
start = date(today.year if today.month >= 7 else today.year - 1, 7, 1)
year_name = f"{start.year}/{start.year + 1}"
years = expect("list tahun ajaran", call("GET", "/api/academic-years", admin), 200)
year = next((y for y in years if y["name"] == year_name), None)
if year is None:
    year = expect("buat tahun ajaran", call("POST", "/api/academic-years", admin, {"name": year_name, "starts_on": str(start), "ends_on": str(date(start.year + 1, 6, 30))}), 200)
expect("aktifkan tahun ajaran", call("POST", f"/api/academic-years/{year['id']}/activate", admin), 200)

semesters = expect("daftar semester", call("GET", "/api/semesters", admin), 200)
if not any(s["ordinal"] == 1 for s in semesters):
    expect("buat semester ganjil", call("POST", "/api/semesters", admin, {"ordinal": 1, "starts_on": str(start), "ends_on": str(date(start.year, 12, 31))}), 200)
    semesters = expect("daftar semester", call("GET", "/api/semesters", admin), 200)
semester = next(s for s in semesters if s["ordinal"] == 1)

mtk = expect("buat mapel", call("POST", "/api/subjects", admin, {"code": f"mtk{tag}", "name": f"Matematika {tag}"}), 200)
guru = expect("buat guru pengampu", call("POST", "/api/users", admin, {"name": "Guru Rapor", "email": f"guru{tag}@sdn1.sch.id", "password": "guru-pass-1", "role": "guru"}), 200)
wali = expect("buat wali kelas", call("POST", "/api/users", admin, {"name": "Wali Rapor", "email": f"wali{tag}@sdn1.sch.id", "password": "wali-pass-1", "role": "wali_kelas"}), 200)
guru_t = login(f"guru{tag}@sdn1.sch.id", "guru-pass-1")
wali_t = login(f"wali{tag}@sdn1.sch.id", "wali-pass-1")

kelas = expect("buat kelas", call("POST", "/api/classes", admin, {"name": f"7R-{tag}", "grade_level": 7, "homeroom_teacher_id": wali["id"]}), 200)
sA = expect("buat siswa A", call("POST", "/api/students", admin, {"nis": f"RA{tag}", "name": "Andi Rapor", "gender": "L", "status": "aktif"}), 200)
sB = expect("buat siswa B", call("POST", "/api/students", admin, {"nis": f"RB{tag}", "name": "Budi Rapor", "gender": "L", "status": "aktif"}), 200)
expect("masukkan siswa ke kelas", call("POST", f"/api/classes/{kelas['id']}/students", admin, {"student_ids": [sA["id"], sB["id"]]}), 200)
asg = expect("guru mengajar mapel di kelas", call("POST", "/api/assignments", admin, {"class_id": kelas["id"], "subject_id": mtk["id"], "teacher_id": guru["id"]}), 200)

# ---------- Master ekstrakurikuler ----------
pramuka = expect("admin menambah kegiatan Pramuka", call("POST", "/api/extracurricular-activities", admin, {"name": f"Pramuka {tag}"}), 200)
paskibra = expect("admin menambah kegiatan Paskibra", call("POST", "/api/extracurricular-activities", admin, {"name": f"Paskibra {tag}"}), 200)
tak = expect("admin menambah kegiatan cadangan", call("POST", "/api/extracurricular-activities", admin, {"name": f"Tak {tag}"}), 200)
expect("guru tidak bisa mengelola master kegiatan", call("POST", "/api/extracurricular-activities", guru_t, {"name": f"Lain {tag}"}), 403)
expect("nama kegiatan kosong ditolak", call("POST", "/api/extracurricular-activities", admin, {"name": "   "}), 422)
expect("nama kegiatan duplikat ditolak", call("POST", "/api/extracurricular-activities", admin, {"name": f"pramuka {tag}"}), 409)
activities = expect("daftar master kegiatan", call("GET", "/api/extracurricular-activities", wali_t), 200)
check("master kegiatan berisi kegiatan baru", any(a["id"] == pramuka["id"] for a in activities), str(activities))

# ---------- Nilai akhir (untuk ketuntasan) ----------
uas = expect("guru menambah komponen UAS", call("POST", "/api/grade-components", guru_t, {"assignment_id": asg["id"], "semester_id": semester["id"], "name": "UAS", "weight": 100}), 200)
expect("isi nilai UAS", call("PUT", "/api/grade-entries", guru_t, {"component_id": uas["id"], "entries": [{"student_id": sA["id"], "score": 90}, {"student_id": sB["id"], "score": 50}]}), 200)
finals = expect("hitung nilai akhir", call("POST", "/api/final-grades/compute", guru_t, {"assignment_id": asg["id"], "semester_id": semester["id"]}), 200)
check("A tuntas KKM", next(f for f in finals if f["student_id"] == sA["id"])["kkm_met"] is True, str(finals))
check("B belum tuntas KKM", next(f for f in finals if f["student_id"] == sB["id"])["kkm_met"] is False, str(finals))

# ---------- Sikap ----------
att_url = "/api/term-attitudes"
expect("guru mapel tidak bisa menulis sikap", call("PUT", att_url, guru_t, {"class_id": kelas["id"], "semester_id": semester["id"], "items": []}), 403)
for bad in ["E", "a", "AB", "Z"]:
    expect(f"predikat sikap '{bad}' ditolak", call("PUT", att_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "items": [
        {"student_id": sA["id"], "aspect": "spiritual", "predicate": bad}]}), 422)
expect("aspek selain spiritual/sosial ditolak", call("PUT", att_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "items": [
    {"student_id": sA["id"], "aspect": "akademik", "predicate": "A"}]}), 422)
expect("siswa di luar kelas ditolak", call("PUT", att_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "items": [
    {"student_id": str(uuid.uuid4()), "aspect": "spiritual", "predicate": "A"}]}), 422)
expect("aspek dobel untuk siswa yang sama ditolak", call("PUT", att_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "items": [
    {"student_id": sA["id"], "aspect": "sosial", "predicate": "A"}, {"student_id": sA["id"], "aspect": "sosial", "predicate": "B"}]}), 422)
rows = expect("baca sikap setelah permintaan gagal", call("GET", f"{att_url}?class_id={kelas['id']}&semester_id={semester['id']}", wali_t), 200)
check("tidak ada sikap tersimpan setelah permintaan gagal", all(r["spiritual"] is None and r["sosial"] is None for r in rows), str(rows))

expect("wali kelas menyimpan sikap A dan B", call("PUT", att_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "items": [
    {"student_id": sA["id"], "aspect": "spiritual", "predicate": "A", "description": "Rajin berdoa"},
    {"student_id": sA["id"], "aspect": "sosial", "predicate": "B", "description": None},
    {"student_id": sB["id"], "aspect": "spiritual", "predicate": "C"},
]}), 200)
expect("hapus sikap sosial B dengan predikat kosong", call("PUT", att_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "items": [
    {"student_id": sB["id"], "aspect": "spiritual", "predicate": ""}]}), 200)

rows = expect("baca sikap", call("GET", f"{att_url}?class_id={kelas['id']}&semester_id={semester['id']}", wali_t), 200)
ra = next(r for r in rows if r["student_id"] == sA["id"])
rb = next(r for r in rows if r["student_id"] == sB["id"])
check("sikap spiritual A = A dengan deskripsi", ra["spiritual"] == {"predicate": "A", "description": "Rajin berdoa"}, str(ra))
check("sikap sosial A = B", ra["sosial"]["predicate"] == "B", str(ra))
check("predikat kosong menghapus sikap B", rb["spiritual"] is None, str(rb))

# ---------- Ekstrakurikuler ----------
ex_url = "/api/term-extracurriculars"
expect("guru mapel tidak bisa menulis ekstrakurikuler", call("PUT", ex_url, guru_t, {"class_id": kelas["id"], "semester_id": semester["id"], "students": []}), 403)
expect("predikat ekstrakurikuler E ditolak", call("PUT", ex_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "students": [
    {"student_id": sA["id"], "items": [{"activity_id": pramuka["id"], "predicate": "E"}]}]}), 422)
expect("predikat ekstrakurikuler kosong ditolak", call("PUT", ex_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "students": [
    {"student_id": sA["id"], "items": [{"activity_id": pramuka["id"], "predicate": ""}]}]}), 422)
expect("kegiatan di luar master ditolak", call("PUT", ex_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "students": [
    {"student_id": sA["id"], "items": [{"activity_id": str(uuid.uuid4()), "predicate": "A"}]}]}), 422)
expect("kegiatan dobel untuk satu siswa ditolak", call("PUT", ex_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "students": [
    {"student_id": sA["id"], "items": [{"activity_id": pramuka["id"], "predicate": "A"}, {"activity_id": pramuka["id"], "predicate": "B"}]}]}), 422)
expect("keterangan lebih dari 500 karakter ditolak", call("PUT", ex_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "students": [
    {"student_id": sA["id"], "items": [{"activity_id": pramuka["id"], "predicate": "A", "description": "x" * 501}]}]}), 422)

expect("wali kelas menyimpan ekstrakurikuler", call("PUT", ex_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "students": [
    {"student_id": sA["id"], "items": [{"activity_id": pramuka["id"], "predicate": "A", "description": "Aktif & disiplin"}]},
    {"student_id": sB["id"], "items": [{"activity_id": paskibra["id"], "predicate": "B"}]},
]}), 200)
rows = expect("baca ekstrakurikuler", call("GET", f"{ex_url}?class_id={kelas['id']}&semester_id={semester['id']}", wali_t), 200)
ea = next(r for r in rows if r["student_id"] == sA["id"])
eb = next(r for r in rows if r["student_id"] == sB["id"])
check("A mengikuti Pramuka predikat A", len(ea["items"]) == 1 and ea["items"][0]["activity"] == f"Pramuka {tag}" and ea["items"][0]["predicate"] == "A", str(ea))
check("B mengikuti Paskibra predikat B", len(eb["items"]) == 1 and eb["items"][0]["predicate"] == "B", str(eb))

expect("daftar A diganti seluruhnya (kosong)", call("PUT", ex_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "students": [
    {"student_id": sA["id"], "items": []}]}), 200)
rows = expect("baca ekstrakurikuler setelah diganti", call("GET", f"{ex_url}?class_id={kelas['id']}&semester_id={semester['id']}", wali_t), 200)
check("A tidak punya ekstrakurikuler setelah diganti", next(r for r in rows if r["student_id"] == sA["id"])["items"] == [], str(rows))
expect("kembalikan Pramuka untuk A", call("PUT", ex_url, wali_t, {"class_id": kelas["id"], "semester_id": semester["id"], "students": [
    {"student_id": sA["id"], "items": [{"activity_id": pramuka["id"], "predicate": "A", "description": "Aktif & disiplin"}]}]}), 200)

# ---------- Master: hapus ----------
expect("kegiatan yang masih dipakai tidak bisa dihapus", call("DELETE", f"/api/extracurricular-activities/{pramuka['id']}", admin), 409)
expect("kegiatan cadangan yang tidak dipakai dihapus", call("DELETE", f"/api/extracurricular-activities/{tak['id']}", admin), 200)
expect("hapus kegiatan yang tidak ada", call("DELETE", f"/api/extracurricular-activities/{tak['id']}", admin), 404)
expect("guru tidak bisa menghapus kegiatan", call("DELETE", f"/api/extracurricular-activities/{paskibra['id']}", guru_t), 403)

# ---------- Ketuntasan ----------
mastery = expect("baca ketuntasan per mapel", call("GET", f"/api/term-mastery?class_id={kelas['id']}&semester_id={semester['id']}", wali_t), 200)
ma = next(m for m in mastery if m["student_id"] == sA["id"])
mb = next(m for m in mastery if m["student_id"] == sB["id"])
check("A tuntas 1 mapel", ma["tuntas"] == 1 and ma["belum_tuntas"] == 0, str(ma))
check("B belum tuntas 1 mapel", mb["tuntas"] == 0 and mb["belum_tuntas"] == 1, str(mb))
check("ketuntasan B per mapel = belum", mb["subjects"][0]["tuntas"] is False, str(mb))

# ---------- Raport ----------
fmt = expect("baca format raport", call("GET", "/api/report-format", admin), 200)
config = json.loads(json.dumps(fmt["config"]))
base_sections = list(config["sections"])
config["sections"] = ["nilai_akademik", "sikap", "ekstrakurikuler", "ketuntasan_tujuan", "catatan_wali_kelas"]
fmt = expect("format memuat blok sikap, ekstrakurikuler, ketuntasan", call("PUT", "/api/report-format", admin, {"expected_version": fmt["version"], "config": config}), 200)
expect("bagian raport duplikat tetap ditolak", call("PUT", "/api/report-format", admin, {"expected_version": fmt["version"], "config": {**config, "sections": ["sikap", "sikap"]}}), 422)

cards = expect("wali kelas generate raport kelas", call("POST", "/api/report-cards/generate", wali_t, {"class_id": kelas["id"], "semester_id": semester["id"]}), 200)
check("raport dibuat untuk dua siswa", len(cards) == 2, str(cards))
ca = next(c for c in cards if c["student_id"] == sA["id"])
cb = next(c for c in cards if c["student_id"] == sB["id"])

status, pdf_a = call("GET", f"/api/report-cards/{ca['id']}/pdf", admin, raw=True)
check(f"PDF raport A bisa diunduh (HTTP {status})", status == 200 and pdf_a[:4] == b"%PDF", f"{len(pdf_a)} byte")
status, pdf_b = call("GET", f"/api/report-cards/{cb['id']}/pdf", admin, raw=True)
check(f"PDF raport B bisa diunduh (HTTP {status})", status == 200 and pdf_b[:4] == b"%PDF", f"{len(pdf_b)} byte")

text_a = pdf_text(pdf_a)
text_b = pdf_text(pdf_b)
if text_a is None:
    SKIPPED.append("isi PDF: pdftotext tidak terpasang")
else:
    check("raport A memuat sikap spiritual dan deskripsinya", "Rajin berdoa" in text_a, text_a[:300])
    check("raport A memuat ekstrakurikuler Pramuka", f"Pramuka {tag}" in text_a, text_a[:300])
    check("raport A memuat ringkasan ketuntasan 1 dari 1 mapel", "1 dari 1 mapel tuntas KKM" in text_a, text_a[:300])
    check("raport B memuat mapel belum tuntas", "Belum tuntas: Matematika" in text_b, text_b[:300])

# Format lama (tanpa blok baru) tetap menghasilkan raport.
fmt = expect("kembalikan format tanpa blok ketuntasan", call("PUT", "/api/report-format", admin, {"expected_version": fmt["version"], "config": {**config, "sections": base_sections}}), 200)
expect("generate ulang dengan format lama", call("POST", "/api/report-cards/generate", wali_t, {"class_id": kelas["id"], "semester_id": semester["id"]}), 200)
status, pdf_a2 = call("GET", f"/api/report-cards/{ca['id']}/pdf", admin, raw=True)
check("raport tetap bisa diunduh dengan format lama", status == 200 and pdf_a2[:4] == b"%PDF", str(status))
text_a2 = pdf_text(pdf_a2)
if text_a2 is not None:
    check("format lama tidak mencetak blok ketuntasan", "Ketuntasan tujuan pembelajaran" not in text_a2, text_a2[:200])

print()
print(f"{PASSED} pemeriksaan lulus.")
for s in SKIPPED:
    print(f"dilewati: {s}")
