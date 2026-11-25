import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";

export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  school_id: string;
  school_name: string;
};

type Session = { token: string; user: User } | null;

type AuthContextValue = {
  token: string | null;
  user: User | null;
  login: (schoolSlug: string, email: string, password: string) => Promise<void>;
  logout: () => void;
};

const STORAGE_KEY = "simas.session";
const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Sesi disimpan di sessionStorage sebagai kenyamanan saat reload di tab yang sama.
 * Sumber kebenaran tetap di server; token yang kedaluwarsa akan ditolak API.
 */
function readStoredSession(): Session {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function writeStoredSession(value: Session) {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage bisa diblokir (mode privat); aplikasi tetap jalan tanpa persistensi.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(() => readStoredSession());

  const login = useCallback(async (schoolSlug: string, email: string, password: string) => {
    const res = await api<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: { school_slug: schoolSlug, email, password },
    });
    const next = { token: res.token, user: res.user };
    writeStoredSession(next);
    setSession(next);
  }, []);

  const logout = useCallback(() => {
    writeStoredSession(null);
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token: session?.token ?? null,
      user: session?.user ?? null,
      login,
      logout,
    }),
    [session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth harus dipakai di dalam AuthProvider");
  return ctx;
}
