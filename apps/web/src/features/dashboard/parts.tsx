import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Selisih terhadap pembanding. Hijau naik, merah turun, abu-abu tidak berubah. */
export function Delta({ value, suffix = "", label }: { value: number; suffix?: string; label: string }) {
  const rounded = Math.round(value * 10) / 10;
  const tone = rounded > 0 ? "text-emerald-600" : rounded < 0 ? "text-red-600" : "text-muted-foreground";
  const sign = rounded > 0 ? "+" : "";
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      <span className={cn("font-medium tabular-nums", tone)}>
        {sign}
        {rounded}
        {suffix}
      </span>{" "}
      {label}
    </p>
  );
}

/** Penanda bahwa sebagian angka di halaman ini masih data contoh. */
export function DummyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
