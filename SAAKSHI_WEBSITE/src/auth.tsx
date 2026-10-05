import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { liveMode } from "./lib/config";
import { supabase } from "./data/supabase";

interface AuthState {
  loading: boolean;
  email: string | null;
  signIn(email: string, password: string): Promise<void>;
  /** Returns true when the account is ready, false when the person must confirm their email first */
  signUp(email: string, password: string, org: string): Promise<boolean>;
  enterDemo(): void;
  signOut(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const DEMO_FLAG = "saakshi.demo.session";

const readDemo = () => {
  try { return localStorage.getItem(DEMO_FLAG) === "1"; } catch { return false; }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(liveMode);
  const [email, setEmail] = useState<string | null>(!liveMode && readDemo() ? "demo@saakshi.local" : null);

  useEffect(() => {
    if (!liveMode) return;
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setEmail(session?.user.email ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      email,
      async signIn(e, p) {
        const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
        if (error) throw new Error(error.message);
      },
      async signUp(e, p, org) {
        // A database trigger (supabase/schema.sql) creates the organisation from org_name
        const { data, error } = await supabase.auth.signUp({ email: e, password: p, options: { data: { org_name: org } } });
        if (error) throw new Error(error.message);
        return Boolean(data.session);
      },
      enterDemo() {
        try { localStorage.setItem(DEMO_FLAG, "1"); } catch { /* ignore */ }
        setEmail("demo@saakshi.local");
      },
      async signOut() {
        if (liveMode) await supabase.auth.signOut();
        else {
          try { localStorage.removeItem(DEMO_FLAG); } catch { /* ignore */ }
          setEmail(null);
        }
      },
    }),
    [loading, email],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
