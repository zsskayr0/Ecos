import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, AlertTriangle } from "lucide-react";
import { NoteCard } from "@/components/cards/NoteCard";
import { TaskCard } from "@/components/cards/TaskCard";
import { EmptyState } from "@/components/common/EmptyState";
import { PullToRefresh } from "@/components/common/PullToRefresh";
import { Rss } from "lucide-react";
import { feed, ApiError } from "@/lib/api";
import { notaDoFeed, tarefaDoFeed } from "@/lib/adapters";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { useAppUI } from "@/lib/ui-context";
import { useAuth } from "@/lib/auth-context";
import { useRefreshBus } from "@/lib/refresh-bus";
import type { FeedItem } from "@/lib/types";

/**
 * Feed — vertical stream interleaving Nota/Tarefa (section 3.1), reading
 * the real `GET /api/v1/feed` (result pre-computed by the ranking job,
 * `app/server/src/jobs/ranking`). Search only exists as the bottom nav's
 * icon (section 2.1) — no duplicate shortcut up here; dragging from the
 * top just refreshes the page (`PullToRefresh`), with no relation to
 * Search (GAP-01 fix: "pull-to-search" became just "pull-to-refresh",
 * Search lives exclusively in the nav).
 *
 * The ranking job doesn't run per request (section 4) — it writes
 * `feed_item` periodically (minimum 30s, `ranking_interval_secs.max(30)`
 * on the server). Capturing a Nota calls `notificar()` right away, but
 * the Feed might not have the new item on the first refetch yet, because
 * the real job hasn't run — without repolling, the screen felt like it
 * "only updated when I reset the page" (the user had to force a manual
 * refetch after the job had already run). This polls every 10s while the
 * Feed is open, no gesture required.
 */
const INTERVALO_POLL_MS = 10_000;
export function FeedScreen() {
  const navigate = useNavigate();
  const { filtroEquipeId } = useAppUI();
  const { equipes } = useMinhasEquipes();
  const { perfil } = useAuth();
  const { versao } = useRefreshBus();
  const [itens, setItens] = useState<FeedItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const pagina = await feed.obter({ espaco: filtroEquipeId ? `equipe:${filtroEquipeId}` : undefined, limit: 40 });
      const mapeados = pagina.items
        .map((item): FeedItem | null => {
          if (item.tipo === "nota") return notaDoFeed(item, equipes, perfil);
          if (item.tipo === "tarefa_encaixada") return tarefaDoFeed(item, perfil);
          return null; // "transacao" and other types have no card of their own in the Feed yet
        })
        .filter((x): x is FeedItem => x !== null);
      setItens(mapeados);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível carregar o Feed. O ecos-app está rodando?");
      setItens([]);
    }
  }, [filtroEquipeId, equipes, perfil]);

  useEffect(() => {
    carregar();
    const id = window.setInterval(carregar, INTERVALO_POLL_MS);
    return () => window.clearInterval(id);
  }, [carregar, versao]);

  return (
    <PullToRefresh onRefresh={carregar}>
      <div className="flex flex-col gap-3 px-4 pt-1">
        {filtroEquipeId && (
          <button
            onClick={() => navigate("/feed")}
            className="flex w-fit items-center gap-1.5 rounded-pill bg-surface-2 px-3 py-1 text-xs font-medium text-text-secondary"
          >
            <X size={12} />
            Ver tudo
          </button>
        )}

        {erro && (
          <div className="flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </div>
        )}

        {itens === null ? (
          <p className="py-10 text-center text-sm text-text-muted">Carregando Feed...</p>
        ) : itens.length === 0 && !erro ? (
          <EmptyState
            icon={Rss}
            title="Zero notas. Sabe aquele grupo sozinho no WhatsApp? Não precisa mais."
            subtitle="Toque no + e capture a primeira coisa que estiver na sua cabeça agora."
          />
        ) : (
          itens.map((item) =>
            item.tipo === "nota" ? <NoteCard key={item.id} nota={item} /> : <TaskCard key={item.id} tarefa={item} />,
          )
        )}
      </div>
    </PullToRefresh>
  );
}
