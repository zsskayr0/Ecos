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
import { useRefreshBus } from "@/lib/refresh-bus";
import type { FeedItem } from "@/lib/types";

/**
 * Feed — stream vertical intercalado Nota/Tarefa (seção 3.1), lendo
 * `GET /api/v1/feed` de verdade (resultado pré-calculado pelo job de
 * ranking, `apps/server/src/jobs/ranking`). Buscar só existe no ícone da
 * bottom nav (seção 2.1) — nenhum atalho duplicado aqui em cima; arrastar
 * a partir do topo só atualiza a página (`PullToRefresh`), sem nenhuma
 * relação com Busca (correção de GAP-01: "pull-to-search" virou só
 * "pull-to-refresh", a Busca mora exclusivamente na nav).
 *
 * O job de ranking não roda por request (seção 4) — ele grava `feed_item`
 * periodicamente (mínimo 30s, `ranking_interval_secs.max(30)` no
 * servidor). Capturar uma Nota chama `notificar()` na hora, mas o Feed
 * ainda pode não ter o item novo no primeiro refetch, porque o job real
 * ainda não rodou — sem repolling, a tela parecia "só atualizar quando eu
 * resetava a página" (o usuário tinha que forçar um refetch manual depois
 * que o job já tinha passado). Isso poll a cada 10s enquanto o Feed está
 * aberto, sem precisar de gesto nenhum.
 */
const INTERVALO_POLL_MS = 10_000;
export function FeedScreen() {
  const navigate = useNavigate();
  const { filtroEquipeId } = useAppUI();
  const { equipes } = useMinhasEquipes();
  const { versao } = useRefreshBus();
  const [itens, setItens] = useState<FeedItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const pagina = await feed.obter({ espaco: filtroEquipeId ? `equipe:${filtroEquipeId}` : undefined, limit: 40 });
      const mapeados = pagina.items
        .map((item): FeedItem | null => {
          if (item.tipo === "nota") return notaDoFeed(item, equipes);
          if (item.tipo === "tarefa_encaixada") return tarefaDoFeed(item);
          return null; // "transacao" e outros tipos não têm card próprio no Feed hoje
        })
        .filter((x): x is FeedItem => x !== null);
      setItens(mapeados);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível carregar o Feed. O ecos-app está rodando?");
      setItens([]);
    }
  }, [filtroEquipeId, equipes]);

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
