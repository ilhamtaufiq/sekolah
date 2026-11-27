import { useMemo, useState, type ClipboardEvent, type FormEvent } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, ErrorAlert, Field, Input, Select, Table, cn, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import type { ClassRow, Student } from "../academic/types";
import type { Assignment } from "../academic/types";
import type { Component, EntryRow, FinalRow, Semester } from "./types";

type Cell = { row: number; col: number };

export function GradesPage() {
  const { token, user } = useAuth();
  const qc = useQueryClient();
  const canWrite = user?.role === "admin" || user?.role === "guru" || user?.role === "wali_kelas";

  const classes = useApiQuery<ClassRow[]>(["classes"], "/classes");
  const semesters = useApiQuery<Semester[]>(["semesters"], "/semesters");
  const [classId, setClassId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [semesterId, setSemesterId] = useState("");
  const effClass = classId || classes.data?.[0]?.id || "";
  const effSemester = semesterId || semesters.data?.find((s) => s.ordinal === 1)?.id || semesters.data?.[0]?.id || "";

  const assignments = useApiQuery<Assignment[]>(["assignments", effClass], effClass ? `/assignments?class_id=${effClass}` : null);
  const effAssignment = assignmentId || assignments.data?.[0]?.id || "";

  const components = useApiQuery<Component[]>(
    ["components", effAssignment, effSemester],
    effAssignment && effSemester ? `/grade-components?assignment_id=${effAssignment}&semester_id=${effSemester}` : null,
  );
  const roster = useApiQuery<Student[]>(["roster", effClass], effClass ? `/classes/${effClass}/students` : null);

  // Nilai per komponen, satu query per kolom.
  const entryQueries = useQueries({
    queries: (components.data ?? []).map((c) => ({
      queryKey: ["entries", c.id],
      queryFn: () => api<EntryRow[]>(`/grade-entries?component_id=${c.id}`, { token }),
      enabled: !!token,
    })),
  });

  // Nilai yang sedang diedit: "studentId|componentId" -> teks input.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [active, setActive] = useState<Cell>({ row: 0, col: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newWeight, setNewWeight] = useState("");

  const students = roster.data ?? [];
  const comps = components.data ?? [];
  const stored = useMemo(() => {
    const map: Record<string, number | null> = {};
    comps.forEach((c, i) => {
      for (const e of entryQueries[i]?.data ?? []) map[`${e.student_id}|${c.id}`] = e.score;
    });
    return map;
  }, [comps, entryQueries]);

  const valueOf = (studentId: string, componentId: string) => {
    const key = `${studentId}|${componentId}`;
    if (key in drafts) return drafts[key];
    const s = stored[key];
    return s === null || s === undefined ? "" : String(s);
  };

  const setCell = (studentId: string, componentId: string, value: string) =>
    setDrafts((d) => ({ ...d, [`${studentId}|${componentId}`]: value }));

  // Sel yang nilainya berbeda dari yang tersimpan.
  const dirtyCount = Object.entries(drafts).filter(([key, text]) => {
    const parsed = text.trim() === "" ? null : Number(text);
    return parsed !== (stored[key] ?? null);
  }).length;

  // Tempel dari Excel: baris = siswa, kolom = komponen, mulai dari sel aktif.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const grid = text.replace(/\r/g, "").split("\n").filter((line, i, arr) => !(i === arr.length - 1 && line === ""));
    grid.forEach((line, dr) => {
      const cells = line.split("\t");
      cells.forEach((raw, dc) => {
        const student = students[active.row + dr];
        const component = comps[active.col + dc];
        if (!student || !component) return;
        setCell(student.id, component.id, raw.trim().replace(",", "."));
      });
    });
    setNotice("Nilai dari papan tempel dimasukkan. Periksa lalu simpan.");
  };

  const saveAll = useApiMutation<{ componentId: string; entries: { student_id: string; score: number | null }[] }, EntryRow[]>(
    {
      method: "PUT",
      path: () => "/grade-entries",
      body: (v) => ({ component_id: v.componentId, entries: v.entries }),
    },
    [],
  );

  const onSave = async () => {
    setNotice(null);
    for (const c of comps) {
      const changes = students
        .filter((s) => `${s.id}|${c.id}` in drafts)
        .map((s) => {
          const raw = drafts[`${s.id}|${c.id}`].trim();
          return { student_id: s.id, score: raw === "" ? null : Number(raw) };
        })
        .filter((row) => row.score !== (stored[`${row.student_id}|${c.id}`] ?? null));
      if (changes.length === 0) continue;
      await saveAll.mutateAsync({ componentId: c.id, entries: changes });
    }
    setDrafts({});
    await qc.invalidateQueries({ queryKey: ["entries"] });
    setNotice("Nilai tersimpan.");
  };

  const addComponent = useApiMutation<void, Component>(
    {
      method: "POST",
      path: () => "/grade-components",
      body: () => ({ assignment_id: effAssignment, semester_id: effSemester, name: newName, weight: Number(newWeight) }),
    },
    [["components", effAssignment, effSemester]],
  );

  const [finals, setFinals] = useState<FinalRow[] | null>(null);
  const compute = useApiMutation<void, FinalRow[]>(
    { method: "POST", path: () => "/final-grades/compute", body: () => ({ assignment_id: effAssignment, semester_id: effSemester }) },
    [],
  );
  const onCompute = async () => setFinals(await compute.mutateAsync());

  const onAddComponent = async (e: FormEvent) => {
    e.preventDefault();
    await addComponent.mutateAsync();
    setNewName("");
    setNewWeight("");
  };

  const totalWeight = comps.reduce((sum, c) => sum + c.weight, 0);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Akademik" title="Input nilai" description="Nilai per komponen. Tempel dari Excel di sel mana pun: baris sesuai urutan siswa, kolom sesuai urutan komponen." />

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Kelas">
          <Select value={effClass} onChange={(e) => { setClassId(e.target.value); setAssignmentId(""); }}>
            {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Mapel">
          <Select value={effAssignment} onChange={(e) => setAssignmentId(e.target.value)}>
            {assignments.data?.map((a) => <option key={a.id} value={a.id}>{a.subject_name} · {a.teacher_name}</option>)}
          </Select>
        </Field>
        <Field label="Semester">
          <Select value={effSemester} onChange={(e) => setSemesterId(e.target.value)}>
            {semesters.data?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.ordinal})</option>)}
          </Select>
        </Field>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      <ErrorAlert error={saveAll.error ?? addComponent.error ?? compute.error} />

      <Card title="Komponen nilai" description={`Total bobot ${totalWeight}. Bobot tidak harus berjumlah 100; nilai akhir dihitung rata-rata berbobot.`}>
        {comps.length === 0 && <p className="text-sm text-slate-500">Belum ada komponen. Tambahkan di bawah.</p>}
        {comps.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {comps.map((c) => <span key={c.id} className="rounded-full bg-slate-100 px-3 py-1 text-sm">{c.name} · bobot {c.weight}</span>)}
          </div>
        )}
        {canWrite && effAssignment && effSemester && (
          <form onSubmit={onAddComponent} className="grid items-end gap-4 md:grid-cols-[1fr_140px_auto]">
            <Field label="Nama komponen">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Tugas, UTS, UAS" maxLength={60} required />
            </Field>
            <Field label="Bobot">
              <Input type="number" min="0.01" max="100" step="0.01" value={newWeight} onChange={(e) => setNewWeight(e.target.value)} required />
            </Field>
            <Button type="submit" disabled={addComponent.isPending}>Tambah komponen</Button>
          </form>
        )}
      </Card>

      {comps.length > 0 && students.length > 0 && (
        <Card
          title={`Daftar nilai · ${students.length} siswa`}
          description={dirtyCount ? `${dirtyCount} sel belum disimpan` : "Semua perubahan sudah tersimpan"}
          actions={
            canWrite && (
              <Button onClick={onSave} disabled={saveAll.isPending || dirtyCount === 0}>
                {saveAll.isPending ? "Menyimpan…" : "Simpan nilai"}
              </Button>
            )
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Siswa</th>
                  {comps.map((c) => <th key={c.id} className="px-3 py-2 text-center">{c.name}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.map((s, r) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span className="font-medium">{s.name}</span> <span className="font-mono text-xs text-slate-500">{s.nis}</span>
                    </td>
                    {comps.map((c, col) => {
                      const key = `${s.id}|${c.id}`;
                      const isDirty = key in drafts;
                      return (
                        <td key={c.id} className="px-2 py-1.5 text-center">
                          <input
                            inputMode="decimal"
                            disabled={!canWrite}
                            value={valueOf(s.id, c.id)}
                            onFocus={() => setActive({ row: r, col })}
                            onPaste={onPaste}
                            onChange={(e) => setCell(s.id, c.id, e.target.value)}
                            aria-label={`${c.name} ${s.name}`}
                            className={cn(
                              "w-20 rounded-md px-2 py-1 text-center ring-1 ring-inset focus:ring-2 focus:ring-brand-500 disabled:bg-slate-100",
                              isDirty ? "bg-amber-50 ring-amber-400" : "ring-slate-300",
                            )}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {comps.length > 0 && students.length > 0 && (
        <Card
          title="Nilai akhir mapel"
          description="Dihitung dari rata-rata berbobot komponen dan dicatat bersama versi format raport yang dipakai."
          actions={canWrite && <Button variant="secondary" onClick={onCompute} disabled={compute.isPending}>Hitung nilai akhir</Button>}
        >
          {!finals && <p className="text-sm text-slate-500">Belum dihitung untuk tampilan ini.</p>}
          {finals && (
            <Table head={["Siswa", "Nilai", "Predikat", "Ketuntasan"]}>
              {finals.map((f) => (
                <tr key={f.student_id}>
                  <td className="px-4 py-2.5 font-medium">{f.name}</td>
                  <td className="px-4 py-2.5">{f.incomplete ? <span className="text-amber-700">belum lengkap</span> : f.score}</td>
                  <td className="px-4 py-2.5">{f.predicate ?? "—"}</td>
                  <td className="px-4 py-2.5">{f.kkm_met === null ? "—" : f.kkm_met ? "Tuntas" : "Belum tuntas"}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
