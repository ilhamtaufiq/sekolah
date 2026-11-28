import type { InputHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import { Button as AriaButton, LinkButton, type buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";
import { Input as UIInput } from "@/components/ui/input";
import { Card as UICard, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { Alert as UIAlert, AlertDescription } from "@/components/ui/alert";
import { cn } from "cn";

/*
 * Lapisan adaptor di atas komponen dari next-shadcn-admin-dashboard-aria (MIT).
 * API lama dipertahankan: onClick -> onPress, render={<Link to />} -> href,
 * dan nama varian lama (primary, danger, secondary) dipetakan.
 */

export { cn };

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

const legacyVariant: Record<string, ButtonVariant> = {
  primary: "default",
  danger: "destructive",
};

type ButtonProps = {
  variant?: ButtonVariant | "primary" | "danger";
  size?: ButtonSize;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  children?: ReactNode;
  onClick?: () => void | Promise<void> | undefined;
  "aria-label"?: string;
  render?: React.ReactElement<{ to?: string }>;
  asChild?: boolean;
};

/** Tombol. Jika `render` berisi <Link to="..."/>, dirender sebagai tautan (lewat RouterProvider). */
export function Button({ variant = "default", size = "default", onClick, render, ...props }: ButtonProps) {
  const resolved = legacyVariant[variant] ?? (variant as ButtonVariant);
  const to = render?.props.to;
  if (to) {
    return <LinkButton variant={resolved} size={size} href={to} {...props} />;
  }
  return <AriaButton variant={resolved} size={size} onPress={() => onClick?.()} {...props} />;
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

/** Select tetap elemen native dengan gaya yang sama dengan input. */
export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      data-slot="select"
      {...props}
      className={cn(
        "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 flex h-8 w-full min-w-0 rounded-lg border px-2.5 py-1 pr-8 text-sm outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
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
  const variant = tone === "error" ? "destructive" : "default";
  return (
    <UIAlert variant={variant} role={tone === "error" ? "alert" : undefined}>
      <AlertDescription>{children}</AlertDescription>
    </UIAlert>
  );
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

/* Tabel HTML biasa. Komponen Table di components/ui memakai react-aria dan berbasis koleksi,
   sehingga baris <tr> tidak bisa langsung dimasukkan di sana. Kelasnya sama dengan komponen aslinya. */
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto rounded-lg border bg-card">
      <table className="w-full caption-bottom text-sm">
        <thead className="bg-muted/60 [&_tr]:border-b">
          <tr className="border-b transition-colors">
            {head.map((h, i) => (
              <th key={i} className="h-10 whitespace-nowrap px-4 text-start align-middle text-xs font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0 [&>tr]:border-b [&>tr:hover]:bg-muted/50">{children}</tbody>
      </table>
    </div>
  );
}

export function TableRow(props: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className="border-b transition-colors hover:bg-muted/50" {...props} />;
}

export function TableCell(props: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className="whitespace-nowrap p-4 align-middle" {...props} />;
}

/** Bilah progres sederhana dengan nilai 0–100. */
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <Progress value={value} className={className}>
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </Progress>
  );
}

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
