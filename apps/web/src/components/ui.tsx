import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { Link } from "react-router";

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
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
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-slate-200 pb-5">
      <div className="min-w-0 space-y-1.5">
        {back ? (
          <Link to={back.to} className="text-sm text-slate-500 hover:text-slate-900">
            ← {back.label}
          </Link>
        ) : (
          eyebrow && <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{eyebrow}</p>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {description && <div className="max-w-2xl text-sm leading-relaxed text-slate-600">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Deretan angka ringkas dalam satu bingkai, dipisahkan garis tipis (bukan kartu di dalam kartu). */
export function StatStrip({ items }: { items: { label: string; value: ReactNode; hint?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 divide-x divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white sm:grid-cols-4 sm:divide-y-0">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 px-4 py-4">
          <dt className="text-xs font-medium text-slate-500">{item.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{item.value}</dd>
          {item.hint && <p className="mt-0.5 truncate text-xs text-slate-500">{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

/** Keadaan kosong yang menjelaskan apa yang bisa dilakukan, bukan sekadar "Belum ada data". */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-6 py-8 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  const styles = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-500",
    secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
    danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500",
    ghost: "text-slate-600 hover:bg-slate-100",
  }[variant];

  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        styles,
        className,
      )}
    />
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
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300",
        "placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500",
        "disabled:bg-slate-100 disabled:text-slate-500",
        className,
      )}
    />
  );
}

export function Card({ title, description, children, actions }: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="space-y-5 px-5 py-5">{children}</div>
    </section>
  );
}

export function Alert({ tone, children }: { tone: "error" | "info" | "success" | "warning"; children: ReactNode }) {
  const styles = {
    error: "bg-red-50 text-red-800 ring-red-200",
    info: "bg-brand-50 text-brand-700 ring-brand-100",
    success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    warning: "bg-amber-50 text-amber-800 ring-amber-200",
  }[tone];
  return <div className={cn("rounded-lg px-4 py-3 text-sm ring-1", styles)}>{children}</div>;
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

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:bg-slate-100",
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-medium text-slate-500">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-2.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 [&>tr:hover]:bg-slate-50/60">{children}</tbody>
      </table>
    </div>
  );
}
