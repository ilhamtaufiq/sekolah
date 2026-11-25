// Uji browser LMS: guru membuat materi dan tugas, siswa melihat ruang kelas dan mengumpulkan.
// Kredensial diambil dari env (diisi oleh pemanggil dari database uji).
const { chromium } = require("playwright");
const SHOTS = "/home/user/simas-scratch/f4";
const BASE = process.env.F4_BASE ?? "http://localhost:5184";
const GURU = process.env.F4_GURU;
const SISWA = process.env.F4_SISWA;

async function login(page, email, password) {
  await page.goto(BASE + "/login");
  await page.getByLabel("Kode sekolah").fill("sdn-1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

(async () => {
  const fs = require("fs");
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("status of 403") && !m.text().includes("status of 422")) errors.push(`console: ${m.text()}`); });
    return page;
  };

  const runTitle = `Tugas e2e ${Date.now()}`;
  // --- Guru ---
  const guru = await newPage();
  await login(guru, GURU, "guru-pass-1");
  await guru.goto(BASE + "/ruang-kelas");
  await guru.getByRole("link", { name: /kelas 7a/i }).first().click();
  await guru.waitForURL(/\/ruang-kelas\/.+/);
  await guru.getByRole("heading", { level: 1 }).waitFor();
  await guru.getByRole("button", { name: "materi", exact: true }).click();
  await guru.getByLabel("Judul").first().fill("Materi e2e");
  await guru.getByLabel("Keterangan").fill("Pengantar uji browser");
  await guru.getByRole("button", { name: "Simpan materi" }).click();
  await guru.getByText("Materi e2e").first().waitFor({ timeout: 8000 });
  await guru.screenshot({ path: `${SHOTS}/guru-materi.png`, fullPage: true });

  await guru.getByRole("button", { name: "tugas", exact: true }).click();
  await guru.getByLabel("Judul").first().fill(runTitle);
  await guru.getByLabel("Tenggat").fill(tomorrowLocal());
  await guru.getByLabel("Nilai maksimum").fill("100");
  await guru.getByRole("button", { name: "Simpan tugas" }).click();
  const taskLink = guru.getByRole("link", { name: "Periksa" }).first();
  await taskLink.waitFor({ timeout: 8000 });
  await guru.screenshot({ path: `${SHOTS}/guru-tugas.png`, fullPage: true });
  await guru.close();

  // --- Siswa ---
  const siswa = await newPage();
  await login(siswa, SISWA, "siswa-pass-1");
  await siswa.waitForURL(/\/ruang-kelas/);
  await siswa.getByRole("heading", { name: "Ruang kelas" }).waitFor();
  await siswa.screenshot({ path: `${SHOTS}/siswa-daftar.png`, fullPage: true });
  await siswa.getByRole("link", { name: /kelas 7a/i }).first().click();
  await siswa.waitForURL(/\/ruang-kelas\/.+/);
  await siswa.getByRole("button", { name: "materi", exact: true }).click();
  await siswa.getByText("Materi e2e").first().waitFor({ timeout: 8000 });
  await siswa.getByRole("button", { name: "tugas", exact: true }).click();
  await siswa.getByRole("row", { name: runTitle }).getByRole("link", { name: "Buka" }).click();
  await siswa.waitForURL(/\/tugas\/.+/);
  await siswa.getByLabel("Jawaban").fill("Jawaban dari siswa e2e");
  await siswa.getByRole("button", { name: "Kumpulkan" }).click();
  await siswa.getByText("Pengumpulan Anda").waitFor({ timeout: 8000 });
  await siswa.screenshot({ path: `${SHOTS}/siswa-tugas.png`, fullPage: true });
  await siswa.close();

  await browser.close();
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "BROWSER E2E LULUS: guru dan siswa, tanpa error");
})().catch((e) => { console.error("E2E FAILED:", e.message); process.exit(1); });

function tomorrowLocal() {
  const d = new Date(Date.now() + 86400000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
