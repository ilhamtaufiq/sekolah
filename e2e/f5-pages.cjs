// Tes browser F5: guru membuat dan menerbitkan paket, siswa mengerjakan dan mengumpulkan.
// Prasyarat: API di :8085, web di :5185, dan fixture dari scripts/smoke_f5.py.
const { chromium } = require("playwright");
const fs = require("fs");

const WEB = "http://localhost:5185";
const API = "http://localhost:8085";
const SHOTS = "/home/user/simas-scratch/f5";
const fixture = JSON.parse(fs.readFileSync(process.env.SIMAS_FIXTURE || "/home/user/simas-scratch/f5-fixture.json", "utf8"));

async function api(path, token, method = "GET", body) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function login(page, email, password) {
  await page.goto(WEB + "/login");
  await page.getByLabel("Kode sekolah").fill("sdn-1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const errors = [];
  const browser = await chromium.launch();
  const title = `E2E ${Date.now()}`;

  // 1. Guru menyiapkan paket lewat API (langkah yang sudah diuji di smoke test), lalu UI guru diuji.
  const guru = await api("/api/auth/login", null, "POST", { school_slug: "sdn-1", email: fixture.guru_email, password: fixture.guru_password });
  const now = Date.now();
  const exam = await api("/api/exams", guru.token, "POST", {
    assignment_id: fixture.assignment_id, title, duration_minutes: 10,
    window_start: new Date(now - 60_000).toISOString(), window_end: new Date(now + 3_600_000).toISOString(),
    shuffle_questions: false, shuffle_options: false, token: null,
  });
  await api(`/api/exams/${exam.id}/questions`, guru.token, "PUT", { question_ids: fixture.question_ids });
  await api(`/api/exams/${exam.id}/publish`, guru.token, "POST");

  const teacherPage = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  teacherPage.on("pageerror", (e) => errors.push(`guru pageerror: ${e.message}`));
  teacherPage.on("console", (m) => { if (m.type() === "error") errors.push(`guru console: ${m.text()}`); });
  await login(teacherPage, fixture.guru_email, fixture.guru_password);
  for (const path of ["/bank-soal", "/ujian", `/ujian/${exam.id}`]) {
    await teacherPage.goto(WEB + path);
    await teacherPage.waitForLoadState("networkidle");
    await teacherPage.waitForTimeout(300);
  }
  await teacherPage.getByRole("heading", { name: title }).waitFor();
  await teacherPage.getByText("Percobaan siswa").waitFor();
  await teacherPage.screenshot({ path: `${SHOTS}/guru-ujian-detail.png`, fullPage: true });
  console.log("guru: paket terbit tampil, halaman bank soal dan detail terbuka");

  // 2. Siswa: mulai, jawab, autosave, kumpulkan.
  const studentCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const student = await studentCtx.newPage();
  student.on("pageerror", (e) => errors.push(`siswa pageerror: ${e.message}`));
  student.on("console", (m) => { if (m.type() === "error") errors.push(`siswa console: ${m.text()}`); });
  student.on("dialog", (d) => d.accept());
  await login(student, fixture.student_email, fixture.student_password);
  await student.waitForURL(`${WEB}/ujian-saya`);
  const row = student.getByRole("row").filter({ hasText: title });
  await row.getByRole("button", { name: "Mulai" }).click();
  await student.waitForURL(/\/kerjakan\//);
  await student.getByText("Sisa waktu").waitFor();
  await student.getByRole("radio").first().check();
  await student.getByText("Tersimpan").waitFor({ timeout: 8000 });
  await student.getByRole("button", { name: "Berikutnya →" }).click();
  await student.getByLabel("Jawaban esai").fill("Air menguap, mengembun, lalu turun sebagai hujan.");
  await student.getByText("Tersimpan").waitFor({ timeout: 8000 });
  await student.screenshot({ path: `${SHOTS}/siswa-mengerjakan.png`, fullPage: true });

  const html = await student.content();
  if (html.includes("kunci")) errors.push("siswa: kata 'kunci' muncul di halaman siswa");

  await student.getByRole("button", { name: "Kumpulkan ujian" }).click();
  await student.getByText("Ujian sudah dikumpulkan").waitFor({ timeout: 8000 });
  await student.screenshot({ path: `${SHOTS}/siswa-selesai.png`, fullPage: true });
  console.log("siswa: mulai, autosave, dan kumpul berhasil");

  await browser.close();
  if (errors.length) {
    console.log("ERRORS:\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log("NO CONSOLE ERRORS");
})().catch((e) => { console.error("E2E FAILED:", e.message); process.exit(1); });
