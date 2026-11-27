import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Alert, Button, Field, Input } from "../../components/ui";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [schoolSlug, setSchoolSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    const to = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={to} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(schoolSlug, email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Sekolah, email, atau password tidak cocok."
          : "Tidak bisa terhubung ke server. Coba lagi sebentar.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="SCHID" className="mx-auto h-28 w-auto object-contain" />
          <h1 className="mt-4 text-xl font-semibold">Masuk ke SCHID</h1>
          <p className="mt-1 text-sm text-slate-500">Gunakan akun yang diberikan admin sekolah.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Kode sekolah" hint="Contoh: sdn-1">
            <Input value={schoolSlug} onChange={(e) => setSchoolSlug(e.target.value)} autoComplete="organization" required />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Memproses…" : "Masuk"}
          </Button>
        </form>
      </div>
    </div>
  );
}
