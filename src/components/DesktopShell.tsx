"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAVIGATION = [
  { href: "/", label: "Dashboard", icon: "⌂" },
  { href: "/live", label: "Live", icon: "◉" },
  { href: "/build-lab", label: "Build Lab", icon: "⌘" },
  { href: "/history", label: "History", icon: "↺" },
  { href: "/trophies", label: "Trophies", icon: "♛" },
  { href: "/extreme-builds", label: "Extremes", icon: "⌁" },
  { href: "/settings", label: "Settings", icon: "⚙" },
] as const;

type ClientStatus = { connected?: boolean; phase?: string; champion?: { name?: string } };

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [client, setClient] = useState<ClientStatus>({});
  const isOverlay = pathname === "/overlay";

  useEffect(() => {
    if (isOverlay) return;
    const source = new EventSource("/api/lcu/status");
    source.addEventListener("state", (event) => {
      try {
        const snapshot = JSON.parse((event as MessageEvent<string>).data) as {
          connection?: { connected?: boolean };
          phase?: string;
          champion?: { name?: string };
        };
        setClient({ connected: snapshot.connection?.connected, phase: snapshot.phase, champion: snapshot.champion });
      } catch { /* A later valid state event will replace malformed input. */ }
    });
    source.onerror = () => setClient((current) => ({ ...current, connected: false }));
    return () => source.close();
  }, [isOverlay]);

  if (isOverlay) return children;

  return (
    <div className="desktop-shell">
      <aside className="desktop-sidebar" aria-label="Primary navigation">
        <Link className="desktop-brand" href="/" aria-label="Arena Build Lab dashboard">
          <span>ABL</span>
          <strong>Arena Build Lab</strong>
        </Link>
        <nav>
          {NAVIGATION.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
            return <Link key={item.href} href={item.href} className={active ? "active" : ""} title={item.label} aria-current={active ? "page" : undefined}>
              <span aria-hidden="true">{item.icon}</span><strong>{item.label}</strong>
            </Link>;
          })}
        </nav>
        <div className="desktop-client-status">
          <i className={client.connected ? "connected" : ""} />
          <div><strong>{client.connected ? "Client connected" : "Waiting for client"}</strong><span>{client.champion?.name || client.phase?.replaceAll("_", " ") || "LCU idle"}</span></div>
        </div>
      </aside>
      <div className="desktop-content" id="desktop-content">{children}</div>
    </div>
  );
}
