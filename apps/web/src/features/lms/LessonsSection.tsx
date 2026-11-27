import { useState } from "react";
import { Link } from "react-router";
import { Alert, Button, Card, ErrorAlert, Field, Input, Table } from "../../components/kit";
import { useApiMutation, useApiQuery } from "../../lib/hooks";

type MaterialOption = {
  id: string;
  title: string;
  youtube_id: string | null;
  files: { id: string; file_name: string; mime: string }[];
};

type LessonSummary = { id: string; title: string; description: string | null; item_count: number; created_at: string };

type Chosen = { key: string; kind: "video" | "pdf"; material_id: string; file_id: string | null; label: string };

/** Daftar pembelajaran di ruang kelas, dan pembuat pembelajaran untuk guru. */
export function LessonsSection({ roomId, materials, manage }: { roomId: string; materials: MaterialOption[]; manage: boolean }) {
  const lessons = useApiQuery<LessonSummary[]>(["lms-lessons", roomId], `/lms/rooms/${roomId}/lessons`);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const options: Chosen[] = materials.flatMap((m) => {
    const list: Chosen[] = [];
    if (m.youtube_id) list.push({ key: `v-${m.id}`, kind: "video", material_id: m.id, file_id: null, label: `Video: ${m.title}` });
    for (const f of m.files) {
      if (f.mime === "application/pdf") {
        list.push({ key: `p-${f.id}`, kind: "pdf", material_id: m.id, file_id: f.id, label: `PDF: ${f.file_name}` });
      }
    }
    return list;
  });

  const create = useApiMutation<void, unknown>(
    {
      method: "POST",
      path: () => `/lms/rooms/${roomId}/lessons`,
      body: () => ({
        title,
        description: description || null,
        items: chosen.map((c) => ({ kind: c.kind, material_id: c.material_id, file_id: c.file_id })),
      }),
    },
    [["lms-lessons", roomId]],
  );
  const remove = useApiMutation<string, unknown>(
    { method: "DELETE", path: (id) => `/lms/lessons/${id}` },
    [["lms-lessons", roomId]],
  );

  const move = (index: number, delta: number) => {
    setChosen((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const onCreate = async () => {
    setNotice(null);
    await create.mutateAsync();
    setNotice(`Pembelajaran "${title}" dibuat.`);
    setTitle("");
    setDescription("");
    setChosen([]);
  };

  return (
    <div className="space-y-6">
      {manage && (
        <Card title="Buat pembelajaran" description="Gabungkan video dan PDF menjadi satu urutan. Siswa mengerjakannya dari atas ke bawah.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Judul pembelajaran">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </Field>
            <Field label="Keterangan" hint="Opsional">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
            </Field>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Materi yang tersedia</p>
            {options.length === 0 && <p className="text-sm text-slate-500">Belum ada video atau PDF di ruang kelas ini. Tambahkan materi dulu.</p>}
            <div className="flex flex-wrap gap-2">
              {options.map((o) => (
                <Button
                  key={o.key}
                  variant="secondary"
                  disabled={chosen.some((c) => c.key === o.key)}
                  onClick={() => setChosen((prev) => [...prev, o])}
                >
                  + {o.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Urutan pembelajaran ({chosen.length})</p>
            {chosen.length === 0 && <p className="text-sm text-slate-500">Pilih materi di atas. Urutannya bisa diubah.</p>}
            <ol className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {chosen.map((c, i) => (
                <li key={c.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-6 tabular-nums text-slate-500">{i + 1}.</span>
                  <span className="flex-1">{c.label}</span>
                  <Button variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Naikkan">↑</Button>
                  <Button variant="ghost" onClick={() => move(i, 1)} disabled={i === chosen.length - 1} aria-label="Turunkan">↓</Button>
                  <Button variant="ghost" onClick={() => setChosen((prev) => prev.filter((x) => x.key !== c.key))}>Hapus</Button>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex items-center justify-end gap-3">
            <ErrorAlert error={create.error} />
            <Button onClick={() => void onCreate()} disabled={!title.trim() || chosen.length === 0 || create.isPending}>
              {create.isPending ? "Menyimpan…" : "Simpan pembelajaran"}
            </Button>
          </div>
        </Card>
      )}

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorAlert error={remove.error} />

      {lessons.data && lessons.data.length === 0 && <p className="text-sm text-slate-500">Belum ada pembelajaran.</p>}
      {lessons.data && lessons.data.length > 0 && (
        <Table head={["Pembelajaran", "Materi", "Dibuat", ""]}>
          {lessons.data.map((l) => (
            <tr key={l.id}>
              <td className="px-4 py-3 font-medium">{l.title}</td>
              <td className="px-4 py-3">{l.item_count}</td>
              <td className="px-4 py-3 text-slate-600">{new Date(l.created_at).toLocaleDateString("id-ID")}</td>
              <td className="space-x-2 px-4 py-3 text-right">
                <Link to={`/pembelajaran/${l.id}`} className="inline-flex items-center rounded-lg px-3.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
                  Buka →
                </Link>
                {manage && (
                  <Button variant="ghost" onClick={() => remove.mutate(l.id)} disabled={remove.isPending}>Hapus</Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
