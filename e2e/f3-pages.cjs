// Uji browser F3: halaman input nilai (termasuk tempel dari Excel), nilai akhir, raport, dan unduh PDF.
const { chromium } = require("playwright");
const fs = require("fs");
const SHOTS = "/home/user/simas-scratch/f3";
const BASE = "http://localhost:5183";
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

  await page.goto(`${BASE}/login`);
  await page.getByLabel("Kode sekolah").fill("sdn-1");
  await page.getByLabel("Email").fill("admin@sdn1.sch.id");
  await page.getByLabel("Password").fill("rahasia-123");
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(`${BASE}/`);

  // Input nilai
  await page.goto(`${BASE}/nilai`);
  await page.getByRole("heading", { name: "Input nilai" }).waitFor();
  await page.getByText("Daftar nilai").waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/nilai.png`, fullPage: true });

  // Tempel dari Excel: dua kolom (tugas, UTS) untuk dua siswa pertama.
  const firstInput = page.locator('input[aria-label^="Tugas "]').first();
  await firstInput.click();
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label^="Tugas "]');
    const dt = new DataTransfer();
    dt.setData("text", "88\t77\n64\t59");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const pasted = await firstInput.inputValue();
  if (pasted !== "88") throw new Error(`tempel dari Excel gagal: nilai pertama = "${pasted}"`);
  await page.getByRole("button", { name: "Simpan nilai" }).click();
  await page.getByText("Nilai tersimpan.").waitFor({ timeout: 10000 });
  console.log("paste + simpan: ok");

  await page.getByRole("button", { name: "Hitung nilai akhir" }).click();
  await page.getByRole("cell", { name: /Tuntas|Belum tuntas/ }).first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/nilai-akhir.png`, fullPage: true });
  console.log("nilai akhir: ok");

  // Raport
  await page.goto(`${BASE}/raport`);
  await page.getByRole("heading", { name: "Catatan dan raport" }).waitFor();
  await page.getByText("Catatan semester").waitFor();
  await page.screenshot({ path: `${SHOTS}/raport.png`, fullPage: true });

  const download = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  const unduh = page.getByRole("button", { name: "Unduh PDF" }).first();
  if (await unduh.count()) {
    await unduh.click();
    const dl = await download;
    if (!dl) throw new Error("unduh PDF tidak memicu download");
    const path = `${SHOTS}/unduhan.pdf`;
    await dl.saveAs(path);
    const size = fs.statSync(path).size;
    if (size < 2048) throw new Error(`PDF unduhan terlalu kecil: ${size} byte`);
    console.log(`unduh PDF: ok (${size} byte)`);
  } else {
    console.log("unduh PDF: lewati (belum ada raport untuk kelas ini)");
  }

  await browser.close();
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "NO CONSOLE ERRORS");
  if (errors.length) process.exit(1);
})().catch((e) => { console.error("E2E FAILED:", e.message); process.exit(1); });
