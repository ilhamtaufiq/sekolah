// Tes browser pembelajaran: siswa membuka PDF per halaman dan menonton video sampai habis.
// YouTube sungguhan tidak bisa dimuat di lingkungan tes; IFrame API diganti pemutar palsu.
// Prasyarat: API di :8080, web di :5173, dan kelas PB-* dari scripts/smoke_pembelajaran.py.
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const SHOTS = "/home/user/simas-scratch/pembelajaran";
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

const FAKE_YT = `
window.YT = {
  PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  Player: function (el, opts) {
    var rec = { opts: opts, t: 0, dur: 3, el: el };
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
  const tag = sql("SELECT SUBSTRING_INDEX(name, '-', -1) FROM classes WHERE name LIKE 'PB-%' ORDER BY created_at DESC LIMIT 1");
  const guruEmail = sql("SELECT email FROM users WHERE role='guru' AND email LIKE 'pbguru%' ORDER BY created_at DESC LIMIT 1");
  const room = sql("SELECT BIN_TO_UUID(a.id) FROM teaching_assignments a JOIN classes c ON c.id=a.class_id WHERE c.name = 'PB-" + tag + "' LIMIT 1");

  // Admin membuat siswa baru di kelas ini, supaya progres dimulai dari nol.
  const admin = (await api("/api/auth/login", null, "POST", { school_slug: "sdn-1", email: "admin@sdn1.sch.id", password: "rahasia-123" })).json.token;
  const kelasId = sql("SELECT BIN_TO_UUID(id) FROM classes WHERE name = 'PB-" + tag + "' LIMIT 1");
  const suffix = Date.now().toString().slice(-6);
  const st = (await api("/api/students", admin, "POST", { nis: "BR" + suffix, name: "Siswa Browser " + suffix, status: "aktif" })).json;
  const siswaEmail = `brow${suffix}@sdn1.sch.id`;
  await api(`/api/students/${st.id}/account`, admin, "POST", { email: siswaEmail, password: "siswa-pass-1" });
  await api(`/api/classes/${kelasId}/students`, admin, "POST", { student_ids: [st.id] });

  // Pembelajaran: video dan PDF dari materi yang sudah ada di ruang kelas.
  const guruToken = (await api("/api/auth/login", null, "POST", { school_slug: "sdn-1", email: guruEmail, password: "guru-pass-1" })).json.token;
  const mats = (await api(`/api/lms/rooms/${room}/materials`, guruToken)).json;
  const pdfMat = mats.find((m) => m.files.some((f) => f.mime === "application/pdf"));
  const pdfFile = pdfMat.files.find((f) => f.mime === "application/pdf").id;
  const vidMat = mats.find((m) => m.youtube_id);
  const title = "Bab Browser " + suffix;
  const created = await api(`/api/lms/rooms/${room}/lessons`, guruToken, "POST", {
    title, description: "Uji browser", items: [{ kind: "video", material_id: vidMat.id }, { kind: "pdf", material_id: pdfMat.id, file_id: pdfFile }],
  });
  if (created.status !== 200) throw new Error("gagal membuat pembelajaran: " + JSON.stringify(created.json));
  const lessonId = created.json.id;

  const errors = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route("https://www.youtube.com/iframe_api", (route) => route.fulfill({ contentType: "application/javascript", body: FAKE_YT }));

  const siswa = await ctx.newPage();
  siswa.on("pageerror", (e) => errors.push(`siswa pageerror: ${e.message}`));
  siswa.on("console", (m) => { if (m.type() === "error") errors.push(`siswa console: ${m.text()}`); });
  await login(siswa, siswaEmail, "siswa-pass-1");
  await siswa.goto(WEB + `/pembelajaran/${lessonId}`);
  await siswa.getByRole("heading", { name: title }).waitFor();
  // PDF dirender dan halaman dilaporkan.
  await siswa.getByText("Halaman 1 / 3").waitFor({ timeout: 20000 });
  await siswa.getByRole("button", { name: "Berikutnya →" }).first().click();
  await siswa.getByText("Halaman 2 / 3").waitFor();
  await siswa.getByRole("button", { name: "Berikutnya →" }).first().click();
  await siswa.getByText("Halaman 3 / 3").waitFor();
  await siswa.getByText("3 dari 3 halaman dibuka").waitFor({ timeout: 8000 });
  console.log("siswa: PDF 3 halaman dibuka dan tercatat");

  // Video: tonton sampai habis (pemutar palsu, durasi 3 detik).
  const card = siswa.locator("section", { hasText: "Video" }).filter({ hasText: vidMat.title }).first();
  await siswa.waitForFunction((t) => !!window.__ytList && !!window.__ytList.find((p) => p.el.closest("section")?.innerText.includes(t)), vidMat.title, { timeout: 20000 });
  for (let i = 0; i < 4; i++) {
    await siswa.evaluate((t) => { const p = window.__ytList.find((x) => x.el.closest("section")?.innerText.includes(t)); p.opts.events.onStateChange({ data: 1 }); }, vidMat.title);
    await siswa.waitForTimeout(1100);
    await siswa.evaluate((t) => { const p = window.__ytList.find((x) => x.el.closest("section")?.innerText.includes(t)); p.t += 1; p.opts.events.onStateChange({ data: 2 }); }, vidMat.title);
    await siswa.waitForTimeout(400);
  }
  void card;
  await siswa.getByText("Anda sudah menyelesaikan semua materi pembelajaran ini.").waitFor({ timeout: 10000 });
  await siswa.getByText("Progres pembelajaran: 100%").waitFor();
  await siswa.screenshot({ path: `${SHOTS}/siswa-selesai.png`, fullPage: true });
  console.log("siswa: video dan PDF selesai, pembelajaran 100%");

  // Guru melihat pembelajaran di ruang kelas.
  const guru = await ctx.newPage();
  guru.on("pageerror", (e) => errors.push(`guru pageerror: ${e.message}`));
  guru.on("console", (m) => { if (m.type() === "error") errors.push(`guru console: ${m.text()}`); });
  await login(guru, guruEmail, "guru-pass-1");
  await guru.goto(WEB + `/ruang-kelas/${room}`);
  await guru.getByText(title).first().waitFor({ timeout: 10000 });
  await guru.screenshot({ path: `${SHOTS}/guru-ruang.png`, fullPage: true });
  console.log("guru: pembelajaran tampil di ruang kelas");

  await browser.close();
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "PEMBELAJARAN PAGES: NO CONSOLE ERRORS");
})().catch((e) => { console.error("E2E FAILED:", e.message); process.exit(1); });
