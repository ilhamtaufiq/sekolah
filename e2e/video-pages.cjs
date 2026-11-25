// Tes browser video YouTube: siswa menonton sampai habis dan guru melihat rekap.
// YouTube sungguhan tidak bisa dimuat di lingkungan tes, jadi IFrame API diganti pemutar palsu
// yang posisi dan durasinya dikendalikan tes. Jalur kode heartbeat tetap yang sebenarnya.
// Prasyarat: API di :8080 (sama dengan web di :5173), data dari scripts/smoke_video.py.
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const SHOTS = "/home/user/simas-scratch/video";
const WEB = "http://localhost:5173";
const API = "http://localhost:8080";
const DB = process.env.SIMAS_DB || "simas_test";

const sql = (q) => execFileSync("mysql", ["-uroot", DB, "-N", "-e", q]).toString().trim();

async function api(path, token, method = "GET", body) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function login(page, email, password) {
  await page.goto(WEB + "/login");
  await page.getByLabel("Kode sekolah").fill("sdn-1");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

// Pemutar YouTube palsu: menyimpan opsi event agar tes bisa memicu PLAYING/PAUSED.
const FAKE_YT = `
window.YT = {
  PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  Player: function (el, opts) {
    var rec = { opts: opts, t: 0, dur: 4, el: el };
    window.__ytList = window.__ytList || [];
    window.__ytList.push(rec);
    this.getCurrentTime = function () { return rec.t; };
    this.getDuration = function () { return rec.dur; };
    this.destroy = function () {};
    setTimeout(function () { opts.events && opts.events.onReady && opts.events.onReady({ target: this }); }, 0);
  }
};
if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
`;

(async () => {
  require("fs").mkdirSync(SHOTS, { recursive: true });
  const tag = sql("SELECT SUBSTRING_INDEX(name, '-', -1) FROM classes WHERE name LIKE 'VID-%' ORDER BY created_at DESC LIMIT 1");
  const guruEmail = sql("SELECT email FROM users WHERE role='guru' AND email LIKE 'vidguru%' ORDER BY created_at DESC LIMIT 1");
  const siswaEmail = sql("SELECT u.email FROM class_enrollments e JOIN classes c ON c.id=e.class_id JOIN students s ON s.id=e.student_id JOIN users u ON u.id=s.user_id WHERE c.name = CONCAT('VID-', '" + tag + "') AND u.email LIKE 'vida%' LIMIT 1");
  const guruLogin = await api("/api/auth/login", null, "POST", { school_slug: "sdn-1", email: guruEmail, password: "guru-pass-1" });
  const guruToken = guruLogin.json.token;
  const room = sql("SELECT BIN_TO_UUID(a.id) FROM teaching_assignments a JOIN classes c ON c.id=a.class_id WHERE c.name = 'VID-" + tag + "' LIMIT 1");

  // Materi video baru khusus tes ini.
  const title = `Tonton ${Date.now()}`;
  const mat = await api(`/api/lms/rooms/${room}/materials`, guruToken, "POST", { title, youtube_url: "https://youtu.be/dQw4w9WgXcQ" });
  if (mat.status !== 200) throw new Error("gagal membuat materi video: " + JSON.stringify(mat.json));

  const errors = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route("https://www.youtube.com/iframe_api", (route) => route.fulfill({ contentType: "application/javascript", body: FAKE_YT }));

  // --- Siswa menonton sampai habis ---
  const siswa = await ctx.newPage();
  siswa.on("pageerror", (e) => errors.push(`siswa pageerror: ${e.message}`));
  siswa.on("console", (m) => { if (m.type() === "error") errors.push(`siswa console: ${m.text()}`); });
  await login(siswa, siswaEmail, "siswa-pass-1");
  await siswa.goto(WEB + `/ruang-kelas/${room}`);
  const card = siswa.locator("section", { hasText: title }).first();
  await card.getByText("Progres tonton:").waitFor();
  // Pemutar milik kartu ini: pemutar yang elemennya berada di dalam kartu dengan judul tes.
  await siswa.waitForFunction((t) => !!window.__ytList && !!window.__ytList.find((p) => p.el.closest("section")?.innerText.includes(t)), title, { timeout: 15000 });
  for (let i = 0; i < 4; i++) {
    await siswa.evaluate((t) => { const p = window.__ytList.find((x) => x.el.closest("section")?.innerText.includes(t)); p.opts.events.onStateChange({ data: 1 }); }, title);
    await siswa.waitForTimeout(1100);
    await siswa.evaluate((t) => { const p = window.__ytList.find((x) => x.el.closest("section")?.innerText.includes(t)); p.t += 1; p.opts.events.onStateChange({ data: 2 }); }, title);
    await siswa.waitForTimeout(400);
  }
  await card.getByText("Selesai", { exact: true }).waitFor({ timeout: 8000 });
  await siswa.screenshot({ path: `${SHOTS}/siswa-selesai.png`, fullPage: true });
  console.log("siswa: menonton 100% dan progres tercatat selesai");

  // --- Guru melihat rekap ---
  const guru = await ctx.newPage();
  guru.on("pageerror", (e) => errors.push(`guru pageerror: ${e.message}`));
  guru.on("console", (m) => { if (m.type() === "error") errors.push(`guru console: ${m.text()}`); });
  await login(guru, guruEmail, "guru-pass-1");
  await guru.goto(WEB + `/ruang-kelas/${room}`);
  await guru.getByRole("button", { name: "materi", exact: false }).first().click().catch(() => undefined);
  await guru.getByText("Progres tonton video").waitFor({ timeout: 10000 });
  await guru.getByText(new RegExp(`${title}.*selesai`)).first().waitFor({ timeout: 10000 });
  await guru.screenshot({ path: `${SHOTS}/guru-rekap.png`, fullPage: true });
  console.log("guru: rekap progres video tampil");

  await browser.close();
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "VIDEO PAGES: NO CONSOLE ERRORS");
})().catch((e) => { console.error("E2E FAILED:", e.message); process.exit(1); });
