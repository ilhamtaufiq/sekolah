// Uji browser: buka setiap halaman F2 sebagai admin, pastikan tidak ada error, dan simpan screenshot.
const { chromium } = require("playwright");
const SHOTS = "/home/user/simas-scratch/f2";
const PAGES = ["/", "/tahun-ajaran", "/mapel", "/kelas", "/siswa", "/staf", "/jadwal", "/absensi"];
(async () => {
  const fs = require("fs");
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  await page.goto("http://localhost:5173/login");
  await page.getByLabel("Kode sekolah").fill("sdn-1");
  await page.getByLabel("Email").fill("admin@sdn1.sch.id");
  await page.getByLabel("Password").fill("rahasia-123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL("http://localhost:5173/");
  for (const path of PAGES) {
    await page.goto("http://localhost:5173" + path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    const body = await page.locator("main").innerText();
    const name = path === "/" ? "beranda" : path.slice(1).replace(/\//g, "-");
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    console.log(`${path.padEnd(16)} ${body.replace(/\s+/g, " ").slice(0, 110)}`);
  }
  await browser.close();
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "NO CONSOLE ERRORS");
})().catch((e) => { console.error("E2E FAILED:", e.message); process.exit(1); });
