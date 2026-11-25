import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, Button, ErrorAlert } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useApiQuery } from "../../lib/hooks";
import { type AttemptView, type TakeQuestion } from "./types";

const SAVE_DELAY_MS = 400;

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: number } | { kind: "error"; message: string };

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function TakeExamPage() {
  const { attemptId = "" } = useParams();
  const { token } = useAuth();
  const attempt = useApiQuery<AttemptView>(["attempt", attemptId], `/student/attempts/${attemptId}`);
  const storageKey = `simas.exam.${attemptId}`;

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [result, setResult] = useState<{ score: number | null; graded: boolean } | null>(null);
  const timers = useRef<Record<string, number>>({});
  const refetchedAtZero = useRef(false);

  // Jam server dipakai untuk semua keputusan waktu. Selisih dihitung sekali saat data diterima.
  useEffect(() => {
    if (attempt.data) setOffset(new Date(attempt.data.server_now).getTime() - Date.now());
  }, [attempt.data]);

  // Muat jawaban dari server, lalu timpa dengan cadangan lokal (jawaban yang belum terkirim).
  useEffect(() => {
    if (!attempt.data) return;
    const fromServer: Record<string, string> = {};
    for (const q of attempt.data.questions) if (q.answer !== null) fromServer[q.question_id] = q.answer;
    let local: Record<string, string> = {};
    try {
      local = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<string, string>;
    } catch {
      local = {};
    }
    setAnswers({ ...fromServer, ...local });
  }, [attempt.data, storageKey]);

  // Jam di layar.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const data = attempt.data;
  // Percobaan yang sudah terkunci di server tetap terkunci setelah halaman dimuat ulang.
  useEffect(() => {
    if (data?.locked) setLocked(true);
  }, [data?.locked]);
  const serverNow = now + offset;
  const deadlineMs = data ? new Date(data.deadline).getTime() : 0;
  const remaining = deadlineMs - serverNow;
  const inProgress = data?.status === "in_progress";

  // Saat waktu habis di klien, minta server menutup percobaan (server yang memutuskan).
  useEffect(() => {
    if (inProgress && remaining <= 0 && !refetchedAtZero.current) {
      refetchedAtZero.current = true;
      void attempt.refetch();
    }
  }, [inProgress, remaining, attempt]);

  const sendAnswer = async (qid: string, value: string | null): Promise<void> => {
    setSave({ kind: "saving" });
    try {
      await api(`/student/attempts/${attemptId}/answers/${qid}`, {
        method: "PUT",
        token,
        body: { answer: value && value.trim() ? value : null },
      });
      setSave({ kind: "saved", at: Date.now() });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Gagal menyimpan. Jawaban tetap ada di perangkat ini.";
      setSave({ kind: "error", message });
      if (err instanceof ApiError && err.status === 409) void attempt.refetch();
    }
  };

  const onAnswer = (qid: string, value: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [qid]: value };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Penyimpanan lokal bisa diblokir; autosave ke server tetap jalan.
      }
      return next;
    });
    window.clearTimeout(timers.current[qid]);
    timers.current[qid] = window.setTimeout(() => void sendAnswer(qid, value), SAVE_DELAY_MS);
  };

  // Jejak kejadian. Ini hanya catatan untuk guru, bukan penguncian browser.
  useEffect(() => {
    if (!inProgress) return;
    const log = (kind: string) => {
      // Keluar dari halaman mengunci ujian sampai siswa membukanya kembali.
      if (kind === "blur" || kind === "hidden") setLocked(true);
      void api(`/student/attempts/${attemptId}/events`, { method: "POST", token, body: { kind } }).catch(() => undefined);
    };
    const onBlur = () => log("blur");
    const onFocus = () => log("focus");
    const onVisibility = () => log(document.hidden ? "hidden" : "visible");
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [inProgress, attemptId, token]);

  const unlock = async () => {
    setUnlockError(null);
    try {
      await api(`/student/attempts/${attemptId}/unlock`, { method: "POST", token });
      setLocked(false);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : "Gagal membuka kembali halaman ujian.");
    }
  };

  const questions: TakeQuestion[] = useMemo(() => data?.questions ?? [], [data]);
  const current = questions[index];

  const onSubmit = async () => {
    if (!window.confirm("Kumpulkan ujian sekarang? Jawaban tidak bisa diubah setelah dikumpulkan.")) return;
    setSubmitting(true);
    setSubmitError(null);
    // Kirim semua jawaban yang masih tertunda sebelum submit.
    for (const [qid, timer] of Object.entries(timers.current)) {
      window.clearTimeout(timer);
      await sendAnswer(qid, answers[qid] ?? null);
    }
    try {
      const res = await api<{ score: number | null; graded: boolean }>(`/student/attempts/${attemptId}/submit`, {
        method: "POST",
        token,
      });
      setResult(res);
      localStorage.removeItem(storageKey);
      void attempt.refetch();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Gagal mengumpulkan. Coba lagi.");
      void attempt.refetch();
    } finally {
      setSubmitting(false);
    }
  };

  if (attempt.isPending) return <p className="text-sm text-slate-500">Memuat ujian…</p>;
  if (attempt.isError) {
    return (
      <div className="space-y-4">
        <ErrorAlert error={attempt.error} />
        <Link to="/ujian-saya" className="text-sm text-brand-700 hover:underline">← Kembali ke ujian saya</Link>
      </div>
    );
  }

  if (!inProgress || result) {
    const score = result?.score ?? data?.score ?? null;
    const graded = result?.graded ?? (data?.score !== null && data?.score !== undefined);
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{data?.title}</h1>
        {data?.status === "expired" ? (
          <Alert tone="warning">
            Waktu habis. Jawaban yang tersimpan sebelum batas waktu yang dihitung.
          </Alert>
        ) : (
          <Alert tone="success">Ujian sudah dikumpulkan.</Alert>
        )}
        {graded && score !== null ? (
          <p className="text-lg">Nilai Anda: <span className="font-semibold">{score}</span></p>
        ) : (
          <p className="text-sm text-slate-600">Nilai akan tampil setelah semua jawaban esai dinilai guru.</p>
        )}
        <Link to="/ujian-saya" className="text-sm text-brand-700 hover:underline">← Kembali ke ujian saya</Link>
      </div>
    );
  }

  const answeredCount = questions.filter((q) => (answers[q.question_id] ?? "").trim() !== "").length;
  const lowTime = remaining < 5 * 60 * 1000;

  return (
    <div className="space-y-6">
      {locked && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="lock-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl">
            <h2 id="lock-title" className="text-lg font-semibold">Ujian terkunci</h2>
            <p className="text-sm text-slate-600">
              Anda keluar dari halaman ujian. Kejadian ini tercatat untuk guru. Jawaban belum bisa diubah sampai Anda membuka kembali halaman ini.
            </p>
            <p className="text-xs text-slate-500">
              Batasan: browser tidak bisa mengunci aplikasi lain di komputer ini. Yang dikunci dan dicatat adalah keluar dari halaman ujian.
            </p>
            {unlockError && <Alert tone="error">{unlockError}</Alert>}
            <Button className="w-full" onClick={() => void unlock()}>Buka kembali halaman ujian</Button>
          </div>
        </div>
      )}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Ujian berlangsung</p>
          <h1 className="text-xl font-semibold tracking-tight">{data?.title}</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className={lowTime ? "rounded-lg bg-red-50 px-4 py-2 text-right ring-1 ring-red-200" : "rounded-lg bg-white px-4 py-2 text-right ring-1 ring-slate-200"}>
            <p className="text-xs text-slate-500">Sisa waktu</p>
            <p className={lowTime ? "font-mono text-xl font-semibold text-red-700" : "font-mono text-xl font-semibold"}>{formatRemaining(remaining)}</p>
          </div>
        </div>
      </header>

      <Alert tone="info">
        Pindah tab atau keluar dari jendela dicatat sebagai jejak untuk guru. Ini bukan penguncian: aplikasi lain tetap bisa dibuka, dan jawaban tetap tersimpan di server.
      </Alert>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>Terjawab {answeredCount} dari {questions.length}</span>
        <span role="status" aria-live="polite">
          {save.kind === "saving" && "Menyimpan…"}
          {save.kind === "saved" && "Tersimpan"}
          {save.kind === "error" && <span className="text-red-700">{save.message}</span>}
        </span>
      </div>

      <nav aria-label="Nomor soal" className="flex flex-wrap gap-2">
        {questions.map((q, i) => {
          const filled = (answers[q.question_id] ?? "").trim() !== "";
          return (
            <button
              key={q.question_id}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={i === index ? "step" : undefined}
              className={
                i === index
                  ? "size-9 rounded-lg bg-brand-600 text-sm font-semibold text-white"
                  : filled
                    ? "size-9 rounded-lg bg-emerald-100 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-300"
                    : "size-9 rounded-lg bg-white text-sm text-slate-600 ring-1 ring-slate-300"
              }
            >
              {i + 1}
            </button>
          );
        })}
      </nav>

      {current && (
        <section className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <p className="text-sm text-slate-500">Soal {current.position} · {current.points} poin</p>
          <p className="mt-2 whitespace-pre-line text-base">{current.body}</p>

          <div className="mt-5 space-y-3">
            {current.kind === "pg" &&
              current.options?.map((o) => {
                const selected = answers[current.question_id] === o.key;
                return (
                  <label
                    key={o.key}
                    className={
                      selected
                        ? "flex cursor-pointer items-start gap-3 rounded-lg bg-brand-50 p-3 ring-2 ring-brand-500"
                        : "flex cursor-pointer items-start gap-3 rounded-lg p-3 ring-1 ring-slate-200 hover:bg-slate-50"
                    }
                  >
                    <input
                      type="radio"
                      name={`q-${current.question_id}`}
                      checked={selected}
                      onChange={() => onAnswer(current.question_id, o.key)}
                      className="mt-1 size-4 text-brand-600"
                    />
                    <span>
                      <span className="font-semibold">{o.key}.</span> {o.text}
                    </span>
                  </label>
                );
              })}
            {current.kind === "esai" && (
              <textarea
                aria-label="Jawaban esai"
                className="block w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500"
                rows={8}
                maxLength={10000}
                value={answers[current.question_id] ?? ""}
                onChange={(e) => onAnswer(current.question_id, e.target.value)}
              />
            )}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
          ← Sebelumnya
        </Button>
        <Button variant="secondary" onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))} disabled={index >= questions.length - 1}>
          Berikutnya →
        </Button>
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? "Mengumpulkan…" : "Kumpulkan ujian"}
        </Button>
      </div>
      {submitError && <ErrorAlert error={{ message: submitError }} />}
    </div>
  );
}
