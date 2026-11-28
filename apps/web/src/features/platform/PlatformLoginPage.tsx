import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { Button, ErrorAlert, Field, Input } from "../../components/kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "../../lib/auth";

/** Login super admin platform. Tidak memakai slug sekolah. */
export function PlatformLoginPage() {
  const { user, loginPlatform } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (user?.role === "superadmin") return <Navigate to="/platform" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await loginPlatform(email, password);
      navigate("/platform", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-sm gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base font-semibold">Masuk super admin</CardTitle>
          <p className="text-sm text-muted-foreground">Dashboard lintas sekolah SCHID.</p>
        </CardHeader>
        <CardContent className="py-5">
          <form onSubmit={onSubmit} className="space-y-4">
            <ErrorAlert error={error} />
            <Field label="Email">
              <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Kata sandi">
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Memproses…" : "Masuk"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
