import { useCallback, useEffect, useState } from "react";
import { CalendarClock, RefreshCw, Smartphone, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Toggle } from "@/components/common/Toggle";
import { notificacoes, type CategoriaNotificacao, type PreferenciaNotificacao } from "@/lib/api";
import { avisar } from "@/lib/toast";
import { desligarPush, distribuidores, estadoPush, ligarPush, sincronizarEndereco, temPushNoCelular, type Distribuidor, type EstadoPush } from "@/lib/push-celular";
import { Linha, Secao } from "./campos-config";

const CATEGORIAS: { id: CategoriaNotificacao; titulo: string; descricao: string; Icone: LucideIcon }[] = [
  { id: "agenda", titulo: "Agenda e prazos", descricao: "Tarefa que vence hoje ou amanhã e tarefa que começa em 15 minutos.", Icone: CalendarClock },
  { id: "equipes", titulo: "Equipes", descricao: "Quando você entra numa equipe ou alguém entra pelo seu convite.", Icone: Users },
  { id: "sync", titulo: "Sincronização", descricao: "Problemas e retomada da sincronização do calendário.", Icone: RefreshCw },
  { id: "cofre", titulo: "Cofre", descricao: "Avisos do Cofre. No celular aparecem sem valores nem nomes; o detalhe fica no app.", Icone: Wallet },
];

/** Por categoria: se o aviso entra na caixa do Ecos e se chega por push nos celulares com avisos ligados. */
export function AvisosPorCategoria() {
  const [prefs, setPrefs] = useState<PreferenciaNotificacao[] | null>(null);
  useEffect(() => { notificacoes.preferencias().then((r) => setPrefs(r.items)).catch(() => setPrefs([])); }, []);

  async function mudar(categoria: CategoriaNotificacao, mudanca: { caixa?: boolean; push?: boolean }) {
    const antes = prefs;
    setPrefs((p) => p?.map((x) => (x.categoria === categoria ? { ...x, ...mudanca } : x)) ?? p);
    try { await notificacoes.definirPreferencia(categoria, mudanca); }
    catch { setPrefs(antes); avisar("Não foi possível salvar a preferência.", "erro"); }
  }

  return (
    <Secao titulo="Avisos por categoria">
      {prefs === null ? <p className="px-4 py-4 text-sm text-text-muted" role="status">Carregando…</p>
        : prefs.length === 0 ? <p className="px-4 py-4 text-sm text-text-muted">Não foi possível carregar as preferências.</p>
        : CATEGORIAS.map(({ id, titulo, descricao, Icone }) => {
          const p = prefs.find((x) => x.categoria === id) ?? { categoria: id, caixa: true, push: true };
          return (
            <Linha key={id} Icone={Icone} titulo={titulo} descricao={descricao}>
              <span className="flex shrink-0 flex-col items-end gap-2 text-xs text-text-muted">
                <label className="flex items-center gap-2">Caixa<Toggle checked={p.caixa} onChange={(caixa) => void mudar(id, { caixa })} label={`${titulo}: caixa de notificações`} /></label>
                <label className="flex items-center gap-2">Celular<Toggle checked={p.caixa && p.push} disabled={!p.caixa} onChange={(push) => void mudar(id, { push })} label={`${titulo}: aviso no celular`} /></label>
              </span>
            </Linha>
          );
        })}
    </Secao>
  );
}

/** Só no app Android: liga os avisos neste celular escolhendo o distribuidor UnifiedPush (ntfy etc.). */
export function AvisosNesteCelular() {
  const [estado, setEstado] = useState<EstadoPush | null>(estadoPush);
  const [lista, setLista] = useState<Distribuidor[]>(distribuidores);
  const [aguardando, setAguardando] = useState(false);
  const atualizar = useCallback(() => { setEstado(estadoPush()); setLista(distribuidores()); }, []);

  useEffect(() => {
    const aoMudar = () => { atualizar(); setAguardando(false); void sincronizarEndereco(); };
    const aoVoltar = () => { if (document.visibilityState === "visible") atualizar(); };
    window.addEventListener("ecos:push-endpoint", aoMudar);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { window.removeEventListener("ecos:push-endpoint", aoMudar); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [atualizar]);

  if (!temPushNoCelular() || !estado) return null;
  const ligado = !!estado.endpoint;
  const nomeAtual = lista.find((d) => d.pacote === estado.distribuidor)?.nome ?? estado.distribuidor;

  return (
    <Secao titulo="Neste celular">
      {ligado ? (
        <Linha Icone={Smartphone} titulo="Avisos ligados" descricao={`Chegam pelo ${nomeAtual ?? "distribuidor"}, mesmo com o Ecos fechado.${estado.permissao ? "" : " O Android está bloqueando as notificações do Ecos: libere nas configurações do sistema."}`}>
          <button type="button" onClick={() => { desligarPush(); atualizar(); }} className="flex min-h-10 shrink-0 items-center rounded-xl border border-border bg-surface-2 px-3 text-sm font-medium text-text-primary hover:bg-surface-3">Desligar</button>
        </Linha>
      ) : lista.length === 0 ? (
        <Linha Icone={Smartphone} titulo="Avisos no celular" descricao="Os avisos chegam por UnifiedPush, sem depender do Google. Instale um distribuidor, como o ntfy (Play Store ou F-Droid), e volte aqui.">
          <button type="button" onClick={atualizar} className="flex min-h-10 shrink-0 items-center rounded-xl border border-border bg-surface-2 px-3 text-sm font-medium text-text-primary hover:bg-surface-3">Procurar</button>
        </Linha>
      ) : lista.map((d) => (
        <Linha key={d.pacote} Icone={Smartphone} titulo={`Receber pelo ${d.nome}`} descricao={aguardando ? "Esperando o distribuidor responder…" : "Liga os avisos do Ecos neste celular, mesmo com o app fechado."}>
          <button type="button" disabled={aguardando} onClick={() => { setAguardando(true); ligarPush(d.pacote); }} className="flex min-h-10 shrink-0 items-center rounded-xl bg-steel-500 px-3 text-sm font-semibold text-white disabled:opacity-50">Ligar</button>
        </Linha>
      ))}
    </Secao>
  );
}
