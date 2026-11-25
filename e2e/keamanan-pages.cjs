// Tes browser: token ujian (guru), mode tes, komponen nilai di tugas LMS, dan raport saya (siswa).
// Prasyarat: API di :8085 dan web di :5185, serta data dari scripts/smoke_integrasi.py.
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const SHOTS = "/home/user/simas-scratch/keamanan";
const WEB = "http://localhost:5185";
const DB = process.env.SIMAS_DB || "simas_test";

function latest(sql) {
  return execFileSync("mysql", ["-uroot", DB, "-N", "-e", sql]).toString().trim();
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
  require("fs").mkdirSync(SHOTS, { recursive: true });
  const guruEmail = latest("SELECT email FROM users WHERE role='guru' AND email LIKE 'integguru%' ORDER BY created_at DESC LIMIT 1");
  const siswaEmail = latest("SELECT email FROM users WHERE role='siswa' AND email LIKE 'integsiswa%' ORDER BY created_at DESC LIMIT 1");
  const errors = [];
  const browser = await chromium.launch();

  // --- Guru: token dan mode tes ---
  const guru = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  guru.on("pageerror", (e) => errors.push(`guru pageerror: ${e.message}`));
  guru.on("console", (m) => { if (m.type() === "error") errors.push(`guru console: ${m.text()}`); });
  await login(guru, guruEmail, "guru-pass-1");
  await guru.goto(WEB + "/ujian");
  await guru.getByRole("row").filter({ hasText: /Tes \d/ }).first().getByRole("link", { name: /Kelola/ }).click();
  await guru.getByText(/Token:/).waitFor();
  const tokenText = await guru.getByText(/Token:/).innerText();
  if (!/tidak ada|terpasang|perlu diatur ulang/.test(tokenText)) errors.push(`token label tidak sesuai: ${tokenText}`);
  await guru.getByRole("link", { name: /Coba ujian/ }).click();
  await guru.getByText("Mode tes").first().waitFor();
  await guru.getByText("Mode tes tidak mengunci halaman").waitFor();
  const previewHtml = await guru.content();
  if (previewHtml.includes("answer_key")) errors.push("pratinjau memuat answer_key");
  await guru.screenshot({ path: `${SHOTS}/mode-tes.png`, fullPage: true });
  console.log("guru: token ditampilkan sebagai status, mode tes terbuka tanpa kunci");

  // Komponen nilai di form tugas LMS.
  await guru.goto(WEB + "/ruang-kelas");
  await guru.getByRole("link", { name: /kelas 9a/i }).first().click();
  await guru.getByRole("button", { name: "tugas", exact: false }).first().click();
  await guru.getByLabel("Judul").first().waitFor();
  const compSelect = guru.getByRole("combobox").filter({ hasText: "tidak terhubung" });
  await compSelect.first().waitFor();
  const options = await compSelect.first().locator("option").allInnerTexts();
  if (!options.some((o) => o.includes("Tugas LMS"))) errors.push(`komponen tidak ada di dropdown: ${options.join(", ")}`);
  await guru.screenshot({ path: `${SHOTS}/tugas-komponen.png`, fullPage: true });
  console.log("guru: dropdown komponen nilai F3 tampil di form tugas");

  // --- Siswa: raport saya ---
  const siswa = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  siswa.on("pageerror", (e) => errors.push(`siswa pageerror: ${e.message}`));
  siswa.on("console", (m) => { if (m.type() === "error") errors.push(`siswa console: ${m.text()}`); });
  await login(siswa, siswaEmail, "siswa-pass-1");
  await siswa.goto(WEB + "/raport-saya");
  await siswa.getByRole("heading", { name: "Raport saya" }).waitFor();
  await siswa.getByText(/Belum ada raport|Tahun ajaran/).first().waitFor();
  await siswa.screenshot({ path: `${SHOTS}/raport-saya.png`, fullPage: true });
  console.log("siswa: halaman raport saya terbuka");

  await browser.close();
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "KEAMANAN PAGES: NO CONSOLE ERRORS");
})().catch((e) => { console.error("E2E FAILED:", e.message); process.exit(1); });
