import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Card, ErrorAlert, Input, Select } from "../../components/ui";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import type { Activity, AttitudeRow, ExtraRow, Predikat } from "./types";

const PREDIKAT: Predikat[] = ["A", "B", "C", "D"];
const KETERANGAN_MAX = 500;

type Aspect = "spiritual" | "sosial";
const ASPECTS: { key: Aspect; label: string }[] = [
  { key: "spiritual", label: "Spiritual" },
  { key: "sosial", label: "Sosial" },
];

/** Predikat kosong berarti belum dinilai; saat disimpan, nilai itu dihapus. */
type AttitudeDraft = { predicate: string; description: string };
type AttitudePair = Record<Aspect, AttitudeDraft>;
type ExtraDraftItem = { activity_id: string; predicate: string; description: string };

const EMPTY_ATTITUDE: AttitudeDraft = { predicate: "", description: "" };
const EMPTY_PAIR: AttitudePair = { spiritual: EMPTY_ATTITUDE, sosial: EMPTY_ATTITUDE };

type Props = {
  classId: string;
  semesterId: string;
  /** Admin atau wali kelas. */
  canEdit: boolean;
  /** Hanya admin yang mengelola master kegiatan ekstrakurikuler. */
  isAdmin: boolean;
};

export function SikapCard({ classId, semesterId, canEdit, isAdmin }: Props) {
  const ready = !!classId && !!semesterId;
  const attitudes = useApiQuery<AttitudeRow[]>(
    ["term-attitudes", classId, semesterId],
    ready ? `/term-attitudes?class_id=${classId}&semester_id=${semesterId}` : null,
  );
  const extras = useApiQuery<ExtraRow[]>(
    ["term-extracurriculars", classId, semesterId],
    ready ? `/term-extracurriculars?class_id=${classId}&semester_id=${semesterId}` : null,
  );
  const activities = useApiQuery<Activity[]>(["extracurricular-activities"], "/extracurricular-activities");

  const [att, setAtt] = useState<Record<string, AttitudePair>>({});
  const [ext, setExt] = useState<Record<string, ExtraDraftItem[]>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [newActivity, setNewActivity] = useState("");

  useEffect(() => {
    if (!attitudes.data) return;
    const next: Record<string, AttitudePair> = {};
    for (const r of attitudes.data) {
      next[r.student_id] = {
        spiritual: { predicate: r.spiritual?.predicate ?? "", description: r.spiritual?.description ?? "" },
        sosial: { predicate: r.sosial?.predicate ?? "", description: r.sosial?.description ?? "" },
      };
    }
    setAtt(next);
  }, [attitudes.data]);

  useEffect(() => {
    if (!extras.data) return;
    const next: Record<string, ExtraDraftItem[]> = {};
    for (const r of extras.data) {
      next[r.student_id] = r.items.map((i) => ({
        activity_id: i.activity_id,
        predicate: i.predicate,
        description: i.description ?? "",
      }));
    }
    setExt(next);
  }, [extras.data]);

  const setAttitude = (studentId: string, aspect: Aspect, patch: Partial<AttitudeDraft>) =>
    setAtt((d) => {
      const pair = d[studentId] ?? EMPTY_PAIR;
      return { ...d, [studentId]: { ...pair, [aspect]: { ...pair[aspect], ...patch } } };
    });

  const setItems = (studentId: string, update: (items: ExtraDraftItem[]) => ExtraDraftItem[]) =>
    setExt((d) => ({ ...d, [studentId]: update(d[studentId] ?? []) }));

  const saveAttitudes = useApiMutation<void, unknown>(
    {
      method: "PUT",
      path: () => "/term-attitudes",
      body: () => ({
        class_id: classId,
        semester_id: semesterId,
        items: Object.entries(att).flatMap(([student_id, pair]) =>
          ASPECTS.map(({ key }) => ({
            student_id,
            aspect: key,
            predicate: pair[key].predicate || null,
            description: pair[key].description.trim() || null,
          })),
        ),
      }),
    },
    [["term-attitudes", classId, semesterId]],
  );

  const saveExtras = useApiMutation<void, unknown>(
    {
      method: "PUT",
      path: () => "/term-extracurriculars",
      body: () => ({
        class_id: classId,
        semester_id: semesterId,
        // Baris tanpa kegiatan dilewati. Daftar tiap siswa diganti seluruhnya.
        students: Object.entries(ext).map(([student_id, items]) => ({
          student_id,
          items: items
            .filter((i) => i.activity_id !== "")
            .map((i) => ({ activity_id: i.activity_id, predicate: i.predicate, description: i.description.trim() || null })),
        })),
      }),
    },
    [["term-extracurriculars", classId, semesterId]],
  );

  const createActivity = useApiMutation<void, Activity>(
    { method: "POST", path: () => "/extracurricular-activities", body: () => ({ name: newActivity }) },
    [["extracurricular-activities"]],
  );

  const deleteActivity = useApiMutation<string, unknown>(
    { method: "DELETE", path: (id) => `/extracurricular-activities/${id}` },
    [["extracurricular-activities"], ["term-extracurriculars", classId, semesterId]],
  );

  const onSave = async () => {
    setNotice(null);
    try {
      await saveAttitudes.mutateAsync();
      await saveExtras.mutateAsync();
      setNotice("Sikap dan ekstrakurikuler tersimpan.");
    } catch {
      // Pesan kesalahan ditampilkan lewat ErrorAlert di bawah.
    }
  };

  const onAddActivity = (e: FormEvent) => {
    e.preventDefault();
    createActivity.mutate(undefined, { onSuccess: () => setNewActivity("") });
  };

  const rows = attitudes.data ?? [];
  const saving = saveAttitudes.isPending || saveExtras.isPending;

  return (
    <Card
      title="Sikap dan ekstrakurikuler"
      description="Predikat A sampai D. Kosongkan predikat sikap untuk menghapus nilainya. Ekstrakurikuler memakai daftar kegiatan sekolah."
      actions={canEdit && <Button onClick={onSave} disabled={saving || rows.length === 0}>{saving ? "Menyimpan…" : "Simpan sikap"}</Button>}
    >
      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorAlert error={saveAttitudes.error ?? saveExtras.error ?? createActivity.error ?? deleteActivity.error} />

      {isAdmin && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-sm font-medium">Master kegiatan ekstrakurikuler</p>
          <form className="flex gap-2" onSubmit={onAddActivity}>
            <Input
              value={newActivity}
              maxLength={100}
              placeholder="Nama kegiatan, mis. Pramuka"
              onChange={(e) => setNewActivity(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={!newActivity.trim() || createActivity.isPending}>
              Tambah
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            {activities.data?.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-xs ring-1 ring-slate-200">
                {a.name}
                <button
                  type="button"
                  className="text-red-600 hover:underline disabled:opacity-50"
                  disabled={deleteActivity.isPending}
                  onClick={() => deleteActivity.mutate(a.id)}
                >
                  Hapus
                </button>
              </span>
            ))}
          </div>
          {activities.data?.length === 0 && (
            <p className="text-xs text-slate-500">Belum ada kegiatan. Tambahkan dulu sebelum mengisi ekstrakurikuler.</p>
          )}
        </div>
      )}

      {attitudes.data && rows.length === 0 && <p className="text-sm text-slate-500">Kelas ini belum punya siswa.</p>}

      <div className="space-y-3">
        {rows.map((r) => {
          const pair = att[r.student_id] ?? EMPTY_PAIR;
          const items = ext[r.student_id] ?? [];
          const setItem = (index: number, patch: Partial<ExtraDraftItem>) =>
            setItems(r.student_id, (list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));
          return (
            <div key={r.student_id} className="space-y-3 rounded-lg p-3 ring-1 ring-slate-200">
              <p className="font-medium">
                {r.name} <span className="font-mono text-xs text-slate-500">{r.nis}</span>
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                {ASPECTS.map(({ key, label }) => (
                  <div key={key} className="text-xs text-slate-600">
                    {label}
                    <div className="mt-1 grid grid-cols-[96px_1fr] gap-2">
                      <Select
                        disabled={!canEdit}
                        value={pair[key].predicate}
                        onChange={(e) => setAttitude(r.student_id, key, { predicate: e.target.value })}
                        aria-label={`Predikat sikap ${label} ${r.name}`}
                      >
                        <option value="">-</option>
                        {PREDIKAT.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </Select>
                      <Input
                        disabled={!canEdit}
                        value={pair[key].description}
                        maxLength={KETERANGAN_MAX}
                        placeholder="Deskripsi (opsional)"
                        onChange={(e) => setAttitude(r.student_id, key, { description: e.target.value })}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-600">Ekstrakurikuler</p>
                {items.length === 0 && <p className="text-xs text-slate-400">Belum ada kegiatan.</p>}
                {items.map((it, index) => (
                  <div key={index} className="grid gap-2 md:grid-cols-[1fr_96px_1fr_auto]">
                    <Select
                      disabled={!canEdit}
                      value={it.activity_id}
                      onChange={(e) => setItem(index, { activity_id: e.target.value })}
                      aria-label="Kegiatan ekstrakurikuler"
                    >
                      <option value="">Pilih kegiatan</option>
                      {activities.data?.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </Select>
                    <Select
                      disabled={!canEdit}
                      value={it.predicate}
                      onChange={(e) => setItem(index, { predicate: e.target.value })}
                      aria-label="Predikat ekstrakurikuler"
                    >
                      <option value="">Predikat</option>
                      {PREDIKAT.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </Select>
                    <Input
                      disabled={!canEdit}
                      value={it.description}
                      maxLength={KETERANGAN_MAX}
                      placeholder="Keterangan (opsional)"
                      onChange={(e) => setItem(index, { description: e.target.value })}
                    />
                    {canEdit && (
                      <Button
                        variant="ghost"
                        onClick={() => setItems(r.student_id, (list) => list.filter((_, i) => i !== index))}
                      >
                        Hapus
                      </Button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <Button
                    variant="secondary"
                    disabled={!activities.data?.length}
                    onClick={() =>
                      setItems(r.student_id, (list) => [...list, { activity_id: "", predicate: "", description: "" }])
                    }
                  >
                    Tambah kegiatan
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
