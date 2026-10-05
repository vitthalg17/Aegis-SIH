import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { liveMode } from "../lib/config";
import { Logo } from "../components/ui";

export function Login() {
  const { email, signIn, signUp, enterDemo } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? "/app";
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (email) return <Navigate to={from} replace />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const em = String(f.get("email")).trim();
    const pw = String(f.get("password"));
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "in") {
        await signIn(em, pw);
        nav(from, { replace: true });
      } else {
        const ready = await signUp(em, pw, String(f.get("org")).trim());
        if (ready) nav("/app", { replace: true });
        else setNotice("Check your email for a confirmation link, then log in.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <Link to="/" aria-label="SAAKSHI home"><Logo /></Link>
        <h1>{mode === "in" ? "Log in" : "Create your account"}</h1>

        {!liveMode ? (
          <>
            <p className="muted">
              No server is connected, so this runs in demo mode with generated sample data. Nothing leaves your browser.
            </p>
            <button className="btn btn-primary btn-lg" onClick={() => { enterDemo(); nav(from, { replace: true }); }}>
              Enter the demo
            </button>
          </>
        ) : (
          <form className="form" onSubmit={submit}>
            {mode === "up" && <label>Company name<input name="org" required autoComplete="organization" /></label>}
            <label>Email<input name="email" type="email" required autoComplete="email" /></label>
            <label>Password<input name="password" type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} /></label>
            {error && <div className="notice notice-bad" role="alert">{error}</div>}
            {notice && <div className="notice notice-good" role="status">{notice}</div>}
            <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? "Please wait" : mode === "in" ? "Log in" : "Sign up"}</button>
            <button type="button" className="btn btn-quiet" onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(null); setNotice(null); }}>
              {mode === "in" ? "New here? Create an account" : "Already have an account? Log in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
