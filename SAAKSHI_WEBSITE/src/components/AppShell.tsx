import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { source } from "../data/source";
import { useAsync } from "../hooks";
import { Logo } from "./ui";

export function AppShell({ children }: { children: ReactNode }) {
  const { email, signOut } = useAuth();
  const nav = useNavigate();
  const alerts = useAsync(() => source.listAlerts(), []);
  const open = (alerts.data ?? []).filter((a) => !a.acked_at).length;

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="topbar-logo" aria-label="SAAKSHI home"><Logo /></NavLink>
        <nav className="topnav" aria-label="Main">
          <NavLink to="/app" end>Nodes</NavLink>
          <NavLink to="/app/alerts">
            Alerts{open > 0 && <span className="count">{open}</span>}
          </NavLink>
          <NavLink to="/app/settings">Settings</NavLink>
        </nav>
        <div className="topbar-user">
          <span className="user-email" title={email ?? ""}>{email}</span>
          <button className="btn btn-quiet" onClick={() => signOut().then(() => nav("/"))}>Sign out</button>
        </div>
      </header>
      {source.mode === "demo" && (
        <div className="demo-banner" role="note">
          <strong>Demo mode.</strong> The readings here are generated samples shaped like the real ledger file, and changes are saved only in this browser.
          Connect Supabase to see real nodes.
        </div>
      )}
      <main className="page">{children}</main>
    </div>
  );
}
