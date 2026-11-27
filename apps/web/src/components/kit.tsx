import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { Link } from "react-router";
import { Button as UIButton } from "@/components/ui/button";
import { Input as UIInput } from "@/components/ui/input";
import { Card as UICard, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table as UITable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/*
 * Lapisan adaptor di atas komponen shadcn (components/ui). Halaman-halaman
 * lama memakai API di file ini; nama dan propertinya dipertahankan supaya
 * tidak perlu diubah satu per satu.
 */

export { cn };

type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";

// Nama varian lama dari kode yang sudah ada.
const legacyVariant: Record<string, ButtonVariant> = {
  primary: "default",
  danger: "destructive",
  secondary: "outline",
};

type ButtonProps = Omit<React.ComponentProps<typeof UIButton>, "variant"> & {
  variant?: ButtonVariant | "primary" | "danger" | "secondary";
};

export function Button({ variant = "default", ...props }: ButtonProps) {
  const resolved = legacyVariant[variant] ?? (variant as ButtonVariant);
  return <UIButton variant={resolved} {...props} />;
}

/** Judul halaman yang seragam: label kecil, judul, deskripsi singkat, dan aksi di kanan. */
export function PageHeader({
  eyebrow,
  title,
  description,
  back,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b pb-5">
      <div className="min-w-0 space-y-1.5">
        {back ? (
          <Link to={back.to} className="text-sm text-muted-foreground hover:text-foreground">
            ← {back.label}
          </Link>
        ) : (
          eyebrow && <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
        )}
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <div className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Deretan angka ringkas dalam satu bingkai, dipisahkan garis tipis. */
export function StatStrip({ items }: { items: { label: string; value: ReactNode; hint?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-lg border bg-card sm:grid-cols-4 sm:divide-y-0">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 px-4 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{item.value}</dd>
          {item.hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

/** Keadaan kosong yang menjelaskan apa yang bisa dilakukan. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

type FieldProps = {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
};

export function Field({ label, error, hint, children }: FieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted-foreground">{hint}</span>}
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <UIInput {...props} className={className} />;
}

// Select tetap elemen native, dengan tampilan yang sama dengan Input.
const selectBase =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 flex h-8 w-full min-w-0 rounded-lg border px-2.5 py-1 pr-8 text-sm outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50";

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select data-slot="select" {...props} className={cn(selectBase, className)}>
      {children}
    </select>
  );
}

export function Card({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <UICard className="gap-0 py-0">
      <CardHeader className="border-b py-3.5">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {actions && <CardAction>{actions}</CardAction>}
      </CardHeader>
      <CardContent className="space-y-5 py-5">{children}</CardContent>
    </UICard>
  );
}

export function Alert({ tone, children }: { tone: "error" | "info" | "success" | "warning"; children: ReactNode }) {
  const styles = {
    error: "border-destructive/30 bg-destructive/5 text-destructive",
    info: "border-primary/20 bg-primary/5 text-primary",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
  }[tone];
  return <div role={tone === "error" ? "alert" : undefined} className={cn("rounded-lg border px-4 py-3 text-sm", styles)}>{children}</div>;
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const apiError = error as { message?: string; details?: { field: string; message: string }[] };
  const details = apiError.details ?? [];
  return (
    <Alert tone="error">
      <p>{apiError.message ?? "Terjadi kesalahan."}</p>
      {details.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {details.map((d, i) => (
            <li key={i}>
              <code className="text-xs">{d.field}</code>: {d.message}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div data-slot="table-container" className="overflow-x-auto rounded-lg border bg-card">
      <UITable>
        <TableHeader className="bg-muted/60">
          <TableRow className="hover:bg-transparent">
            {head.map((h, i) => (
              <TableHead key={i} className="whitespace-nowrap px-4 text-xs font-medium text-muted-foreground">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </UITable>
    </div>
  );
}

export { TableCell, TableRow };

/** Kontrol halaman di bawah tabel. Menerima hasil dari usePagination. */
export function Pagination({
  page,
  pageCount,
  total,
  from,
  to,
  setPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
  setPage: (p: number) => void;
}) {
  if (total === 0) return null;
  return (
    <nav aria-label="Paginasi" className="flex flex-wrap items-center justify-between gap-3 pt-3 text-sm">
      <p className="tabular-nums text-muted-foreground">
        Menampilkan {from}–{to} dari {total}
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
            Sebelumnya
          </Button>
          <span className="min-w-[7.5rem] text-center tabular-nums" aria-live="polite">
            Halaman {page} dari {pageCount}
          </span>
          <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page >= pageCount}>
            Berikutnya
          </Button>
        </div>
      )}
    </nav>
  );
}

export { CardContent };
