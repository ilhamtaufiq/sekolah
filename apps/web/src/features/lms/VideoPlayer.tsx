import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";

type Progress = { watched_seconds: number; duration_seconds: number | null; percent: number; completed: boolean };

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const HEARTBEAT_MS = 10_000;
let apiLoading: Promise<void> | null = null;

/** Memuat YouTube IFrame API sekali saja untuk seluruh halaman. */
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!apiLoading) {
    apiLoading = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve();
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.onerror = () => {
        apiLoading = null;
        reject(new Error("gagal memuat YouTube"));
      };
      document.head.appendChild(script);
    });
  }
  return apiLoading;
}

/**
 * Pemutar video YouTube. Siswa mengirim heartbeat posisi saat video diputar,
 * dan server menghitung progres. Guru hanya melihat pemutar tanpa melapor.
 */
export function VideoPlayer({
  materialId,
  youtubeId,
  token,
  track,
}: {
  materialId: string;
  youtubeId: string;
  token: string | null;
  track: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const timerRef = useRef<number | null>(null);
  const trackRef = useRef(track);
  const tokenRef = useRef(token);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trackRef.current = track;
    tokenRef.current = token;
  }, [track, token]);

  useEffect(() => {
    if (!track) return;
    api<Progress>(`/lms/materials/${materialId}/progress`, { token })
      .then(setProgress)
      .catch(() => undefined);
  }, [materialId, token, track]);

  useEffect(() => {
    let cancelled = false;

    const sendBeat = () => {
      const player = playerRef.current;
      if (!trackRef.current || !player) return;
      const position = player.getCurrentTime?.();
      const duration = player.getDuration?.();
      if (!duration || position === undefined) return;
      api<Progress>(`/lms/materials/${materialId}/progress`, {
        method: "POST",
        token: tokenRef.current,
        body: { position, duration },
      })
        .then(setProgress)
        .catch(() => undefined);
    };
    const stopTimer = () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };

    loadYouTubeApi()
      .then(() => {
        if (cancelled || !hostRef.current) return;
        playerRef.current = new window.YT.Player(hostRef.current, {
          videoId: youtubeId,
          playerVars: { rel: 0, modestbranding: 1 },
          events: {
            onStateChange: (e: any) => {
              const state = window.YT.PlayerState;
              if (e.data === state.PLAYING) {
                stopTimer();
                timerRef.current = window.setInterval(sendBeat, HEARTBEAT_MS);
              } else {
                // Jeda, selesai, atau buffering: kirim posisi terakhir lalu berhenti menghitung.
                stopTimer();
                sendBeat();
              }
            },
          },
        });
      })
      .catch(() => setError("Pemutar video gagal dimuat. Periksa koneksi internet Anda."));

    return () => {
      cancelled = true;
      stopTimer();
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [materialId, youtubeId]);

  const percent = progress?.percent ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      <div className="mx-auto aspect-video w-full max-w-2xl overflow-hidden rounded-lg bg-slate-900">
        <div ref={hostRef} className="h-full w-full" />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {track && progress && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">Progres tonton: {percent}%</span>
            {progress.completed ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Selesai</span>
            ) : (
              <span className="text-xs text-slate-500">Tonton sampai habis untuk menyelesaikan</span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-slate-500">Melompat ke depan tidak dihitung sebagai menonton.</p>
        </div>
      )}
    </div>
  );
}
