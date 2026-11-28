#!/usr/bin/env python3
"""Mengisi sekolah kosong dengan data demo lewat API.

Prasyarat: sekolah dan admin sudah dibuat dengan CLI, lalu server berjalan:
  simas-api create-school --slug demo --name "SD Demo Nusantara"
  simas-api create-user --school demo --email admin@demo.sch.id --name "Admin Demo" --password "admin-demo-1"

Lalu:
  python3 scripts/seed_demo.py --base http://localhost:8080 --email admin@demo.sch.id --password admin-demo-1

Semua akun demo memakai password DEMO_PASSWORD. Jangan jalankan di sekolah asli.
Skrip menolak berjalan jika sekolah sudah punya kelas di tahun ajaran aktif.
"""

import argparse
import json
import random
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

DEMO_PASSWORD = "demo-pass-1"
SUBJECTS = [("MTK", "Matematika"), ("BIN", "Bahasa Indonesia"), ("IPA", "Ilmu Pengetahuan Alam"),
            ("IPS", "Ilmu Pengetahuan Sosial"), ("PJOK", "Pendidikan Jasmani")]
CLASSES = [("7A", 7), ("7B", 7), ("8A", 8), ("8B", 8)]
FIRST = ["Andi", "Budi", "Citra", "Dewi", "Eko", "Fitri", "Gilang", "Hana", "Indra", "Joko", "Kartika", "Lukman",
         "Maya", "Nadia", "Oka", "Putri", "Rizki", "Sari", "Tegar", "Umi", "Vino", "Wulan", "Yusuf", "Zahra"]
LAST = ["Pratama", "Saputra", "Lestari", "Wijaya", "Hidayat", "Ramadhani", "Nugroho", "Setiawan", "Permata", "Utami"]
TEACHER_NAMES = ["Ibu Ratna", "Pak Surya", "Ibu Dian", "Pak Hendra", "Ibu Melati"]


class Api:
    def __init__(self, base, token=None):
        self.base = base.rstrip("/")
        self.token = token

    def call(self, method, path, body=None, token=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("content-type", "application/json")
        tok = token or self.token
        if tok:
            req.add_header("authorization", f"Bearer {tok}")
        try:
            with urllib.request.urlopen(req) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raise SystemExit(f"{method} {path} gagal ({e.code}): {e.read().decode(errors='replace')[:300]}")

    def login(self, slug, email, password):
        return self.call("POST", "/api/auth/login", {"school_slug": slug, "email": email, "password": password})["token"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8080")
    ap.add_argument("--slug", default="demo")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    args = ap.parse_args()
    rnd = random.Random(42)
    api = Api(args.base)
    api.token = api.login(args.slug, args.email, args.password)
    today = date.today()

    # 1. Tahun ajaran dan semester
    years = api.call("GET", "/api/academic-years")
    if any(y["is_active"] for y in years) and api.call("GET", "/api/classes"):
        sys.exit("Sekolah ini sudah punya kelas di tahun ajaran aktif. Jalankan skrip di sekolah kosong.")
    start_year = today.year if today.month >= 7 else today.year - 1
    name = f"{start_year}/{start_year + 1}"
    year = next((y for y in years if y["name"] == name), None)
    if year is None:
        year = api.call("POST", "/api/academic-years", {"name": name, "starts_on": f"{start_year}-07-01", "ends_on": f"{start_year + 1}-06-30"})
    if not year["is_active"]:
        year = api.call("POST", f"/api/academic-years/{year['id']}/activate")
    sems = [api.call("POST", "/api/semesters", {"ordinal": 1, "starts_on": f"{start_year}-07-01", "ends_on": f"{start_year}-12-31"}),
            api.call("POST", "/api/semesters", {"ordinal": 2, "starts_on": f"{start_year + 1}-01-01", "ends_on": f"{start_year + 1}-06-30"})]
    sem1 = sems[0]
    print(f"tahun ajaran {name} aktif")

    # 2. Mapel dan guru
    subj = {code: api.call("POST", "/api/subjects", {"code": code, "name": nm}) for code, nm in SUBJECTS}
    teachers = []
    for i, nm in enumerate(TEACHER_NAMES):
        email = f"guru{i + 1}@demo.sch.id"
        teachers.append(api.call("POST", "/api/users", {"name": nm, "email": email, "password": DEMO_PASSWORD, "role": "guru"}))
    homerooms = []
    for i, (cname, _) in enumerate(CLASSES):
        email = f"wali{i + 1}@demo.sch.id"
        homerooms.append(api.call("POST", "/api/users", {"name": f"Wali kelas {cname}", "email": email, "password": DEMO_PASSWORD, "role": "wali_kelas"}))
    print(f"{len(subj)} mapel, {len(teachers)} guru, {len(homerooms)} wali kelas")

    # 3. Kelas dan siswa
    classes = [api.call("POST", "/api/classes", {"name": cname, "grade_level": grade, "homeroom_teacher_id": homerooms[i]["id"]})
               for i, (cname, grade) in enumerate(CLASSES)]
    students_by_class = []
    nis = 260001
    for c in classes:
        roster = []
        for _ in range(20):
            first, last = rnd.choice(FIRST), rnd.choice(LAST)
            gender = rnd.choice(["L", "P"])
            s = api.call("POST", "/api/students", {"nis": str(nis), "name": f"{first} {last}", "gender": gender, "status": "aktif"})
            api.call("POST", f"/api/students/{s['id']}/account", {"email": f"siswa{nis}@demo.sch.id", "password": DEMO_PASSWORD})
            roster.append(s)
            nis += 1
        api.call("POST", f"/api/classes/{c['id']}/students", {"student_ids": [s["id"] for s in roster]})
        students_by_class.append(roster)
    print(f"{len(classes)} kelas, {sum(len(r) for r in students_by_class)} siswa dengan akun")

    # 4. Penugasan dan jadwal (setiap kelas punya slot sendiri, jadi tidak ada bentrok)
    assignments = {}
    for ci, c in enumerate(classes):
        for si, (code, _) in enumerate(SUBJECTS):
            teacher = teachers[si]
            asg = api.call("POST", "/api/assignments", {"class_id": c["id"], "subject_id": subj[code]["id"], "teacher_id": teacher["id"]})
            assignments[(ci, si)] = asg
            hour = 7 + ci
            api.call("POST", "/api/schedules", {
                "assignment_id": asg["id"], "day_of_week": si + 1,
                "start_time": f"{hour:02d}:00:00", "end_time": f"{hour:02d}:45:00", "room": f"R-{c['name']}"})
    print(f"{len(assignments)} penugasan dan jadwal")

    # 5. Nilai semester 1: tiga komponen per mapel
    for (ci, si), asg in assignments.items():
        roster = students_by_class[ci]
        comps = []
        for name_c, weight in [("Tugas", 30), ("UH", 30), ("PTS", 40)]:
            comps.append(api.call("POST", "/api/grade-components", {"assignment_id": asg["id"], "semester_id": sem1["id"], "name": name_c, "weight": weight}))
        for comp in comps:
            rows = [{"student_id": s["id"], "score": float(rnd.randint(55, 100))} for s in roster]
            api.call("PUT", "/api/grade-entries", {"component_id": comp["id"], "entries": rows})
        api.call("POST", "/api/final-grades/compute", {"assignment_id": asg["id"], "semester_id": sem1["id"]})
    print("nilai semester 1 dan nilai akhir dihitung")

    # 6. Absensi: lima hari sekolah terakhir sebelum hari ini
    days = []
    d = today - timedelta(days=1)
    while len(days) < 5:
        if d.weekday() < 5 and d >= date(start_year, 7, 1):
            days.append(d)
        d -= timedelta(days=1)
    for day in days:
        for ci, c in enumerate(classes):
            records = []
            for s in students_by_class[ci]:
                roll = rnd.random()
                status = "H" if roll < 0.9 else ("S" if roll < 0.95 else ("I" if roll < 0.98 else "A"))
                records.append({"student_id": s["id"], "status": status})
            api.call("PUT", "/api/attendance/sessions", {
                "kind": "harian", "class_id": c["id"], "assignment_id": None,
                "session_date": str(day), "records": records}, token=api.login(args.slug, f"wali{ci + 1}@demo.sch.id", DEMO_PASSWORD))
    print(f"absensi harian {len(days)} hari untuk {len(classes)} kelas")

    # 7. LMS: pengumuman dan materi di setiap ruang kelas, tugas untuk MTK
    for (ci, si), asg in assignments.items():
        teacher_tok = api.login(args.slug, f"guru{si + 1}@demo.sch.id", DEMO_PASSWORD)
        api.call("POST", f"/api/lms/rooms/{asg['id']}/announcements",
                 {"title": "Selamat datang", "body": f"Selamat datang di pelajaran {SUBJECTS[si][1]} semester ini."}, token=teacher_tok)
        api.call("POST", f"/api/lms/rooms/{asg['id']}/materials",
                 {"title": "Panduan belajar", "body": "Baca bab 1 dan kerjakan latihan di buku."}, token=teacher_tok)
        if si == 0:
            due = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
            api.call("POST", f"/api/lms/rooms/{asg['id']}/tasks",
                     {"title": "Latihan bab 1", "instructions": "Kerjakan soal 1 sampai 10.", "due_at": due, "max_score": 100, "allow_late": True}, token=teacher_tok)
    print("pengumuman, materi, dan tugas LMS dibuat")

    print("\nSelesai. Akun demo (password semua akun: " + DEMO_PASSWORD + "):")
    print(f"  admin: {args.email}")
    print("  guru: guru1@demo.sch.id ... guru5@demo.sch.id")
    print("  wali kelas: wali1@demo.sch.id ... wali4@demo.sch.id")
    print(f"  siswa: siswa{260001}@demo.sch.id ... siswa{nis - 1}@demo.sch.id")

    # Dikembalikan agar skrip lanjutan (seed_demo_lengkap.py) bisa memakai data ini.
    return {
        "api": api,
        "slug": args.slug,
        "classes": classes,
        "students_by_class": students_by_class,
        "assignments": assignments,
        "subjects": subj,
        "teachers": teachers,
        "homerooms": homerooms,
        "sem1": sem1,
        "days": days,
        "start_year": start_year,
    }


if __name__ == "__main__":
    main()
