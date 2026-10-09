import { EstadoCarregando } from "@/components/common/EstadoCarregando";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, AlertTriangle } from "lucide-react";
import { ListaDeItens } from "@/components/views/ListaDeItens";
import { EmptyState } from "@/components/common/EmptyState";
import { PullToRefresh } from "@/components/common/PullToRefresh";
import { Rss } from "lucide-react";
import { feed, notas, tarefas, ApiError } from "@/lib/api";
import { notaDoFeed, notaResumoParaView, tarefaDoFeed, tarefaResumoParaView } from "@/lib/adapters";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { useAppUI } from "@/lib/ui-context";
import { useAuth } from "@/lib/auth-context";
import { useRefreshBus } from "@/lib/refresh-bus";
import { CapturaRapida } from "@/components/feed/CapturaRapida";
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
const JANELA_RECENTE_MS = 10 * 60_000;
export function FeedScreen() {
  const navigate = useNavigate();
  const { filtroEquipeId, espacoAtivo, intercalarEquipes } = useAppUI();
  const { equipes } = useMinhasEquipes();
  const { perfil } = useAuth();
  const { versao } = useRefreshBus();
  const [itens, setItens] = useState<FeedItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const espaco = intercalarEquipes
        ? (filtroEquipeId ? `equipe:${filtroEquipeId}` : undefined)
        : espacoAtivo;
      const [pagina, notasRecentes, tarefasRecentes] = await Promise.all([
        feed.obter({ espaco, limit: 40 }),
        notas.listar({ espaco, limit: 10 }).catch(() => null),
        tarefas.listar({ espaco, limit: 10 }).catch(() => null),
      ]);
      const mapeados = pagina.items
        .map((item): FeedItem | null => {
          if (item.tipo === "nota") return notaDoFeed(item, equipes, perfil);
          if (item.tipo === "tarefa_encaixada") return tarefaDoFeed(item, equipes, perfil);
          return null; // "transacao" and other types have no card of their own in the Feed yet
        })
        .filter((x): x is FeedItem => x !== null);
      // O ranking só grava o feed de tempos em tempos (>= 30s); o que acabou de ser criado entra já,
      // direto da listagem, e é trocado pelo item ranqueado quando o servidor o incluir.
      const noFeed = new Set(mapeados.map((i) => `${i.tipo}:${i.id}`));
      const limite = Date.now() - JANELA_RECENTE_MS;
      const recente = (iso: string | undefined) => !!iso && new Date(iso).getTime() >= limite;
      const novos: FeedItem[] = [
        ...(notasRecentes?.items ?? []).filter((n) => recente(n.criado_em) && !noFeed.has(`nota:${n.id}`)).map((n) => notaResumoParaView(n, equipes, perfil)),
        ...(tarefasRecentes?.items ?? []).filter((t) => recente(t.criado_em) && t.status !== "concluida" && !noFeed.has(`tarefa:${t.id}`)).map((t) => tarefaResumoParaView(t, equipes, perfil)),
      ];
      setItens([...novos, ...mapeados]);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível carregar o Feed. O ecos-app está rodando?");
      setItens([]);
    }
  }, [filtroEquipeId, espacoAtivo, intercalarEquipes, equipes, perfil]);

  useEffect(() => {
    carregar();
    const id = window.setInterval(carregar, INTERVALO_POLL_MS);
    return () => window.clearInterval(id);
  }, [carregar, versao]);

  return (
    <PullToRefresh onRefresh={carregar}>
      <div className="flex flex-col gap-3 px-4 pt-1">
        <div className="mx-auto w-full max-w-[780px]"><CapturaRapida /></div>
        {intercalarEquipes && filtroEquipeId && (
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
          <EstadoCarregando texto="Carregando Feed…" />
        ) : itens.length === 0 && !erro ? (
          <EmptyState
            icon={Rss}
            title="Zero notas. Sabe aquele grupo sozinho no WhatsApp? Não precisa mais."
            subtitle="Toque no + e capture a primeira coisa que estiver na sua cabeça agora."
          />
        ) : (
          <ListaDeItens itens={itens} modo="cards" chave="feed" exibirFiltros={false} selecionavel={false} />
        )}
      </div>
    </PullToRefresh>
  );
}
