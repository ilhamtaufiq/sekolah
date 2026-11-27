import type { ComponentProps, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { Link } from "react-router";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

export { cn };

/* ---------------------------------------------------------------------------
 * Primitif bergaya shadcn/ui. API lama (variant "primary" / "danger", dsb.)
 * tetap didukung supaya halaman yang sudah ada tidak perlu diubah.
 * ------------------------------------------------------------------------- */

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        secondary: "border border-input bg-secondary text-secondary-foreground shadow-xs hover:bg-muted",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3",
        lg: "h-10 px-5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

// Nama varian lama dari kode yang sudah ada.
const legacyVariant: Record<string, NonNullable<VariantProps<typeof buttonVariants>["variant"]>> = {
  primary: "default",
  danger: "destructive",
};

type ButtonProps = ComponentProps<"button"> & {
  variant?: VariantProps<typeof buttonVariants>["variant"] | "primary" | "danger";
  size?: VariantProps<typeof buttonVariants>["size"];
  asChild?: boolean;
};

export function Button({ variant = "default", size, asChild = false, className, ...props }: ButtonProps) {
  const resolved = (variant && legacyVariant[variant as string]) || (variant as VariantProps<typeof buttonVariants>["variant"]);
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant: resolved, size }), className)} {...props} />;
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
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-border pb-5">
      <div className="min-w-0 space-y-1.5">
        {back ? (
          <Link to={back.to} className="text-sm text-muted-foreground hover:text-foreground">
            ← {back.label}
          </Link>
        ) : (
          eyebrow && <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        {description && <div className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Deretan angka ringkas dalam satu bingkai, dipisahkan garis tipis (bukan kartu di dalam kartu). */
export function StatStrip({ items }: { items: { label: string; value: ReactNode; hint?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-4 sm:divide-y-0">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 px-4 py-4">
          <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{item.value}</dd>
          {item.hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

/** Keadaan kosong yang menjelaskan apa yang bisa dilakukan, bukan sekadar "Belum ada data". */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-8 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
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
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted-foreground">{hint}</span>}
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </label>
  );
}

const controlBase =
  "block w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input data-slot="input" {...props} className={cn(controlBase, "h-9 py-1", className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select data-slot="select" {...props} className={cn(controlBase, "h-9 py-1 pr-8", className)}>
      {children}
    </select>
  );
}

export function Card({ title, description, children, actions }: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section data-slot="card" className="rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="space-y-5 px-5 py-5">{children}</div>
    </section>
  );
}

export function Alert({ tone, children }: { tone: "error" | "info" | "success" | "warning"; children: ReactNode }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    info: "border-brand-100 bg-brand-50 text-brand-700",
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
    <div data-slot="table-container" className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="min-w-full text-sm">
        <thead className="border-b border-border bg-muted/60 text-left text-xs font-medium text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border [&>tr:hover]:bg-muted/50">{children}</tbody>
      </table>
    </div>
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
      <p className="text-muted-foreground tabular-nums">
        Menampilkan {from}–{to} dari {total}
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
            Sebelumnya
          </Button>
          <span className="min-w-[7.5rem] text-center tabular-nums text-foreground" aria-live="polite">
            Halaman {page} dari {pageCount}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setPage(page + 1)} disabled={page >= pageCount}>
            Berikutnya
          </Button>
        </div>
      )}
    </nav>
  );
}
