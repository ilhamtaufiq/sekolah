import { useState, type FormEvent } from "react";
import { Button, Card, ErrorAlert, Field, Input, Table } from "../../components/ui";
import { useAuth } from "../../lib/auth";
import { useApiMutation, useApiQuery } from "../../lib/hooks";
import type { Subject } from "./types";

export function SubjectsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const subjects = useApiQuery<Subject[]>(["subjects"], "/subjects");

  const [editing, setEditing] = useState<Subject | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  const reset = () => {
    setEditing(null);
    setCode("");
    setName("");
  };

  const save = useApiMutation<void, Subject>(
    {
      method: editing ? "PUT" : "POST",
      path: () => (editing ? `/subjects/${editing.id}` : "/subjects"),
      body: () => ({ code, name }),
    },
    [["subjects"]],
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await save.mutateAsync();
    reset();
  };

  const startEdit = (s: Subject) => {
    setEditing(s);
    setCode(s.code);
    setName(s.name);
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">Akademik</p>
        <h1 className="text-2xl font-semibold tracking-tight">Mata pelajaran</h1>
      </header>

      <ErrorAlert error={save.error} />

      {canEdit && (
        <Card title={editing ? `Ubah ${editing.name}` : "Tambah mapel"}>
          <form onSubmit={onSubmit} className="grid items-end gap-4 md:grid-cols-[180px_1fr_auto_auto]">
            <Field label="Kode">
              <Input value={code} onChange={(e) => setCode(e.target.value)} required maxLength={20} />
            </Field>
            <Field label="Nama">
              <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
            </Field>
            <Button type="submit" disabled={save.isPending}>{editing ? "Simpan" : "Tambah"}</Button>
            {editing && (
              <Button type="button" variant="secondary" onClick={reset}>Batal</Button>
            )}
          </form>
        </Card>
      )}

      {subjects.data && (
        <Table head={["Kode", "Nama", ""]}>
          {subjects.data.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-center text-slate-500">Belum ada mapel.</td>
            </tr>
          )}
          {subjects.data.map((s) => (
            <tr key={s.id}>
              <td className="px-4 py-3 font-mono text-xs">{s.code}</td>
              <td className="px-4 py-3">{s.name}</td>
              <td className="px-4 py-3 text-right">
                {canEdit && (
                  <Button variant="ghost" onClick={() => startEdit(s)}>Ubah</Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
