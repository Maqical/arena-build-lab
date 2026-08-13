"use client";

import { useEffect, useState } from "react";
import type { GameStateSnapshot } from "@/lib/lcu/GameStateMonitor";
import type { LobbyMemberAnalysis } from "@/lib/lobby-analysis";

export function LobbyScanner({ snapshot }: { snapshot: GameStateSnapshot }) {
  const [members, setMembers] = useState<LobbyMemberAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const memberPayload = JSON.stringify(snapshot.lobbyMembers);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/lobby-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ members: JSON.parse(memberPayload) }),
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((value: { members: LobbyMemberAnalysis[] }) => setMembers(value.members))
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [memberPayload]);

  return (
    <section className="lobby-scanner">
      <div className="overlay-section-title">
        <span>Arena lobby</span>
        <b>{loading ? "Scanning…" : `${members.length} players`}</b>
      </div>
      {members.length ? members.map((member) => (
        <article key={member.puuid || `${member.gameName}#${member.tagLine}`}>
          <div>
            <strong>{member.gameName}{member.tagLine ? `#${member.tagLine}` : ""}</strong>
            <span>{member.rank || "Unranked"} · {member.mostPlayed.map((champion) => champion.championName).join(" · ") || "No local history"}</span>
          </div>
          <dl>
            <div><dt>Games</dt><dd>{member.games}</dd></div>
            <div><dt>1st</dt><dd>{member.firstPlaceRate == null ? "—" : `${(member.firstPlaceRate * 100).toFixed(0)}%`}</dd></div>
            <div><dt>Avg</dt><dd>{member.averagePlacement?.toFixed(1) ?? "—"}</dd></div>
          </dl>
        </article>
      )) : (
        <p className="overlay-muted">Lobby identities are not exposed in this client phase yet.</p>
      )}
    </section>
  );
}
