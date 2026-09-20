import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronLeft } from "lucide-react";
import { notificacoes as notificacoesApi, ApiError, type NotificacaoApi } from "@/lib/api";
import { formatTempoRelativo } from "@/lib/format";
import { EmptyState } from "@/components/common/EmptyState";
import { useRefreshBus } from "@/lib/refresh-bus";

const ABAS: { valor: NotificacaoApi["categoria"] | "tudo"; label: string }[] = [
  { valor: "tudo", label: "Tudo" },
  { valor: "cofre", label: "Cofre" },
  { valor: "agenda", label: "Agenda" },
  { valor: "equipes", label: "Equipes" },
];

/** Color by area — violet is exclusive to the Vault everywhere in the UI (rule 3, section 1.3). */
const COR_AREA: Record<NotificacaoApi["categoria"], string> = {
  cofre: "text-violet",
  agenda: "text-cyan",
  equipes: "text-steel-300",
};

function agruparPorData(itens: NotificacaoApi[]) {
  const grupos: Record<string, NotificacaoApi[]> = { Hoje: [], Ontem: [], "Esta semana": [], Antes: [] };
  const agora = Date.now();
  for (const n of itens) {
    const diffDias = Math.floor((agora - new Date(n.criado_em).getTime()) / 86_400_000);
    if (diffDias < 1) grupos.Hoje.push(n);
    else if (diffDias < 2) grupos.Ontem.push(n);
    else if (diffDias < 7) grupos["Esta semana"].push(n);
    else grupos.Antes.push(n);
  }
  return grupos;
}

/** Notifications — grouped by date, tabs by area, unread dot (section 3.10), real `GET /notificacoes`. */
export function NotificationsScreen() {
  const navigate = useNavigate();
  const { versao, notificar } = useRefreshBus();
  const [aba, setAba] = useState<NotificacaoApi["categoria"] | "tudo">("tudo");
  const [itens, setItens] = useState<NotificacaoApi[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    notificacoesApi
      .listar({ categoria: aba === "tudo" ? undefined : aba, limit: 100 })
      .then((p) => setItens(p.items))
      .catch((e) => setErro(e instanceof ApiError ? e.message : "Não foi possível carregar."));
  }, [aba, versao]);

  const grupos = useMemo(() => agruparPorData(itens ?? []), [itens]);

  async function abrir(n: NotificacaoApi) {
    if (!n.lida) {
      try {
        await notificacoesApi.marcarLida(n.id);
        notificar();
      } catch {
        /* silent — doesn't block reading it */
      }
    }
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-4 flex items-center gap-2">
        <button data-voltar onClick={() => navigate(-1)} className="text-text-muted">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl text-text-primary">Notificações</h1>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto no-scrollbar">
        {ABAS.map((a) => (
          <button
            key={a.valor}
            onClick={() => setAba(a.valor)}
            className={`shrink-0 rounded-pill px-4 py-1.5 text-sm font-medium ${
              aba === a.valor ? "bg-surface-3 text-text-primary" : "bg-surface-2 text-text-secondary"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {erro && <p className="mb-4 text-sm text-error">{erro}</p>}

      {itens === null ? (
        <p className="py-10 text-center text-sm text-text-muted">Carregando...</p>
      ) : itens.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Nada por aqui ainda."
          subtitle="Alertas de Cofre, Agenda e Equipes vão aparecer aqui assim que acontecerem."
        />
      ) : (
        Object.entries(grupos)
          .filter(([, lista]) => lista.length > 0)
          .map(([grupo, lista]) => (
            <div key={grupo} className="mb-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{grupo}</p>
              <div className="flex flex-col gap-1">
                {lista.map((n) => (
                  <button key={n.id} onClick={() => abrir(n)} className="flex w-full items-start gap-3 rounded-2xl px-2 py-2.5 text-left">
                    <div className="min-w-0 flex-1">
                      <p className={`text-[15px] font-medium ${COR_AREA[n.categoria]}`}>{n.titulo}</p>
                      <p className="text-sm text-text-secondary">{n.corpo}</p>
                      <p className="mt-0.5 text-xs text-text-muted">{formatTempoRelativo(n.criado_em)}</p>
                    </div>
                    {!n.lida && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan" />}
                  </button>
                ))}
              </div>
            </div>
          ))
      )}
    </div>
  );
}
