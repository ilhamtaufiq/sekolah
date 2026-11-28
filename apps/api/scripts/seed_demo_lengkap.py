#!/usr/bin/env python3
"""Mengisi sekolah kosong dengan data demo lengkap, lewat API. Satu perintah:

  1. Buat sekolah dan admin (sekali saja, lihat di bawah).
  2. Jalankan server.
  3. Jalankan skrip ini:

     python3 scripts/seed_demo_lengkap.py --base http://localhost:8080 \
         --email admin@demo.sch.id --password admin-demo-1

Yang dibuat:
  - Dasar (seed_demo.py): tahun ajaran, mapel, guru, kelas, siswa, jadwal, nilai, absensi 5 hari.
  - Absensi 10 hari tambahan, supaya tren kehadiran terisi.
  - Sikap dan ekstrakurikuler per siswa (semester 1).
  - Jurnal mengajar: sebagian disetujui, satu ditolak lalu diajukan ulang, sebagian masih menunggu.
  - Forum diskusi di materi, lengkap dengan balasan guru.
  - Ujian PG untuk MTK kelas 7A, sudah diterbitkan.
  - Kelulusan 10 siswa kelas 8B, dengan sertifikat bernomor.
  - Cetak rapor massal kelas 7A (diproses di latar belakang, skrip menunggu sampai selesai).

Syarat sama dengan seed_demo.py: sekolah harus kosong (belum ada kelas di tahun ajaran aktif).
Semua akun demo memakai password demo-pass-1, kecuali admin. Jangan jalankan di sekolah asli.
"""

import argparse
import datetime as dt
import json
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import seed_demo  # noqa: E402
from seed_demo import DEMO_PASSWORD, Api  # noqa: E402

PRED = ["A", "B", "B", "C"]
ACTIVITIES = ["Pramuka", "Basket", "Tari"]
NOTES = {
    "A": "Sangat baik dalam kegiatan kelas.",
    "B": "Baik, terus tingkatkan.",
    "C": "Perlu lebih aktif dan disiplin.",
}


def log(msg):
    print(f"  {msg}", flush=True)


def login(api, slug, email):
    return api.login(slug, email, DEMO_PASSWORD)


def attendance_days(today, count, skip):
    """Hari sekolah (Senin–Jumat) ke belakang, dilewati `skip` hari pertama."""
    days, d, seen = [], today - dt.timedelta(days=1), 0
    while len(days) < count:
        if d.weekday() < 5:
            seen += 1
            if seen > skip:
                days.append(d)
        d -= dt.timedelta(days=1)
    return days


def extra_attendance(ctx, rnd):
    api, slug = ctx["api"], ctx["slug"]
    today = dt.date.today()
    days = attendance_days(today, 10, skip=5)
    for day in days:
        for ci, c in enumerate(ctx["classes"]):
            records = []
            for s in ctx["students_by_class"][ci]:
                roll = rnd.random()
                status = "H" if roll < 0.9 else ("S" if roll < 0.95 else ("I" if roll < 0.98 else "A"))
                records.append({"student_id": s["id"], "status": status})
            wali = login(api, slug, f"wali{ci + 1}@demo.sch.id")
            api.call("PUT", "/api/attendance/sessions", {
                "kind": "harian", "class_id": c["id"], "assignment_id": None,
                "session_date": str(day), "records": records}, token=wali)
    log(f"absensi tambahan {len(days)} hari")


def sikap_dan_ekstra(ctx, rnd):
    api, slug, sem1 = ctx["api"], ctx["slug"], ctx["sem1"]
    admin = api.token
    activity_ids = [api.call("POST", "/api/extracurricular-activities", {"name": n}, token=admin)["id"] for n in ACTIVITIES]
    for ci, c in enumerate(ctx["classes"]):
        wali = login(api, slug, f"wali{ci + 1}@demo.sch.id")
        items = []
        for s in ctx["students_by_class"][ci]:
            for aspect in ("spiritual", "sosial"):
                p = rnd.choice(PRED)
                items.append({"student_id": s["id"], "aspect": aspect, "predicate": p, "description": NOTES[p]})
        api.call("PUT", "/api/term-attitudes", {"class_id": c["id"], "semester_id": sem1["id"], "items": items}, token=wali)

        students = []
        for s in ctx["students_by_class"][ci]:
            picks = rnd.sample(activity_ids, k=rnd.choice([1, 2]))
            ex_items = []
            for aid in picks:
                p = rnd.choice(PRED)
                ex_items.append({"activity_id": aid, "predicate": p, "description": NOTES[p]})
            students.append({"student_id": s["id"], "items": ex_items})
        api.call("PUT", "/api/term-extracurriculars", {"class_id": c["id"], "semester_id": sem1["id"], "students": students}, token=wali)
    log(f"sikap dan ekstrakurikuler untuk {len(ctx['classes'])} kelas")


def jurnal(ctx):
    api, slug = ctx["api"], ctx["slug"]
    admin = api.token
    days = attendance_days(dt.date.today(), 4, skip=0)  # 4 hari sekolah terakhir
    created = approved = rejected = pending = 0
    for (ci, si), asg in ctx["assignments"].items():
        guru = login(api, slug, f"guru{si + 1}@demo.sch.id")
        for n, day in enumerate(days):
            body = {
                "assignment_id": asg["id"],
                "journal_date": str(day),
                "hour_no": 1,
                "topic": f"Materi {ctx['subject_names'][si]} pertemuan {n + 1}",
                "notes": "Kelas berjalan lancar.",
                "present_count": 18,
            }
            j = api.call("POST", "/api/jurnal", body, token=guru)
            created += 1
            if n == 0 and si == 0 and ci == 0:
                # Satu jurnal ditolak, diperbaiki, lalu diajukan ulang dan disetujui.
                api.call("POST", f"/api/jurnal/{j['id']}/submit", token=guru)
                api.call("POST", f"/api/jurnal/{j['id']}/reject", {"note": "Materi belum lengkap, tambahkan rincian."}, token=admin)
                rejected += 1
                api.call("PUT", f"/api/jurnal/{j['id']}", {**body, "topic": body["topic"] + " (diperbaiki)"}, token=guru)
                api.call("POST", f"/api/jurnal/{j['id']}/submit", token=guru)
                api.call("POST", f"/api/jurnal/{j['id']}/approve", {"note": None}, token=admin)
                approved += 1
            elif n == len(days) - 1 and (ci + si) % 3 == 0:
                # Hari terakhir sebagian dibiarkan menunggu persetujuan.
                api.call("POST", f"/api/jurnal/{j['id']}/submit", token=guru)
                pending += 1
            else:
                api.call("POST", f"/api/jurnal/{j['id']}/submit", token=guru)
                api.call("POST", f"/api/jurnal/{j['id']}/approve", {"note": None}, token=admin)
                approved += 1
    log(f"jurnal: {created} dibuat, {approved} disetujui, {rejected} sempat ditolak, {pending} menunggu")


def forum(ctx, rnd):
    api, slug = ctx["api"], ctx["slug"]
    count = 0
    for (ci, si), asg in ctx["assignments"].items():
        if ci >= 2 or si >= 2:
            continue
        guru = login(api, slug, f"guru{si + 1}@demo.sch.id")
        mats = api.call("GET", f"/api/lms/rooms/{asg['id']}/materials", token=guru)
        if not mats:
            continue
        mid = mats[0]["id"]
        student = ctx["students_by_class"][ci][0]
        stok = login(api, slug, f"siswa{student['nis']}@demo.sch.id")
        top = api.call("POST", f"/api/lms/materials/{mid}/comments", {"body": "Bu, bagian latihan nomor 5 maksudnya bagaimana?"}, token=stok)
        api.call("POST", f"/api/lms/materials/{mid}/comments", {"body": "Coba kerjakan dengan cara yang sama seperti contoh di awal bab.", "parent_id": top["id"]}, token=guru)
        count += 2
    log(f"forum: {count} komentar")


def ujian(ctx):
    api, slug = ctx["api"], ctx["slug"]
    admin = api.token
    guru = login(api, slug, "guru1@demo.sch.id")
    asg = ctx["assignments"][(0, 0)]  # MTK, kelas 7A
    subj = ctx["subjects"]["MTK"]
    qids = []
    soal = [
        ("Berapakah 7 + 5?", ["10", "11", "12", "13"], "C"),
        ("Berapakah 9 × 3?", ["24", "27", "30", "33"], "B"),
        ("Berapakah 18 ÷ 2?", ["6", "8", "9", "12"], "C"),
        ("Berapakah 1/2 + 1/4?", ["1/6", "2/6", "3/4", "1/8"], "C"),
        ("Berapakah 0,5 × 10?", ["5", "0,5", "50", "15"], "A"),
    ]
    for body, opts, key in soal:
        q = api.call("POST", "/api/questions", {
            "subject_id": subj["id"], "kind": "pg", "body": body,
            "options": [{"key": k, "text": t} for k, t in zip("ABCD", opts)],
            "answer_key": key, "points": 20,
        }, token=guru)
        qids.append(q["id"])
    now = dt.datetime.now(dt.timezone.utc)
    exam = api.call("POST", "/api/exams", {
        "assignment_id": asg["id"], "title": "Latihan Bab 1 — Operasi Hitung",
        "duration_minutes": 30,
        "window_start": (now - dt.timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_end": (now + dt.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "shuffle_questions": True, "shuffle_options": True,
        "token": None, "clear_token": False, "generate_token": False,
    }, token=guru)
    api.call("PUT", f"/api/exams/{exam['id']}/questions", {"question_ids": qids}, token=guru)
    api.call("POST", f"/api/exams/{exam['id']}/publish", token=guru)
    log("ujian PG 5 soal untuk MTK kelas 7A, sudah diterbitkan")


def kelulusan(ctx):
    api = ctx["api"]
    admin = api.token
    year = next(y for y in api.call("GET", "/api/academic-years", token=admin) if y["is_active"])
    roster = api.call("GET", f"/api/promotions?academic_year_id={year['id']}", token=admin)
    pick = [r for r in roster if r["class_name"] == "8B" and r["decision"] is None][:10]
    if not pick:
        log("kelulusan: tidak ada siswa 8B yang bisa diluluskan")
        return
    items = [{"student_id": r["student_id"], "decision": "lulus", "to_class_id": None} for r in pick]
    res = api.call("POST", "/api/promotions/process", {
        "academic_year_id": year["id"], "certificate_code": None, "items": items,
    }, token=admin)
    certs = res.get("certificates", []) if isinstance(res, dict) else []
    log(f"kelulusan {len(items)} siswa kelas 8B, sertifikat {len(certs)}")


def cetak(ctx):
    api = ctx["api"]
    admin = api.token
    job = api.call("POST", "/api/cetak-massal/jobs", {
        "class_id": ctx["classes"][0]["id"], "semester_id": ctx["sem1"]["id"],
    }, token=admin)
    deadline = time.time() + 180
    while time.time() < deadline:
        st = api.call("GET", f"/api/cetak-massal/jobs/{job['id']}", token=admin)
        if st["status"] in ("selesai", "gagal"):
            log(f"cetak rapor massal 7A: {st['status']}")
            return
        time.sleep(3)
    log("cetak rapor massal 7A: belum selesai setelah 180 detik, cek di menu Cetak massal")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8080")
    ap.add_argument("--slug", default="demo")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    args = ap.parse_args()

    # Dasar: sama dengan seed_demo.py. Skrip ini berhenti jika sekolah sudah terisi.
    sys.argv = ["seed_demo.py", "--base", args.base, "--slug", args.slug, "--email", args.email, "--password", args.password]
    print("1/8 data dasar")
    ctx = seed_demo.main()
    ctx["subject_names"] = ["Matematika", "Bahasa Indonesia", "Ilmu Pengetahuan Alam", "Ilmu Pengetahuan Sosial", "Pendidikan Jasmani"]
    rnd = random.Random(7)

    print("2/8 absensi tambahan")
    extra_attendance(ctx, rnd)
    print("3/8 sikap dan ekstrakurikuler")
    sikap_dan_ekstra(ctx, rnd)
    print("4/8 jurnal mengajar")
    jurnal(ctx)
    print("5/8 forum materi")
    forum(ctx, rnd)
    print("6/8 ujian")
    ujian(ctx)
    print("7/8 kelulusan dan sertifikat")
    kelulusan(ctx)
    print("8/8 cetak rapor massal")
    cetak(ctx)

    print("\nSelesai. Semua akun demo memakai password " + DEMO_PASSWORD + " (kecuali admin).")
    print(f"  admin: {args.email}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"GAGAL: {e}", file=sys.stderr)
        sys.exit(1)
