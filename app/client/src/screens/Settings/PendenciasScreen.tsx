import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarX2, CheckCircle2, ChevronRight, CloudUpload, Copy, FileWarning, RefreshCw, SquareArrowOutUpRight, Trash2, WifiOff } from "lucide-react";
import { descartarMutacaoPendente, enviarMutacaoPendente, problemasArquivos, problemasSync, sincronizarPendenciasOffline } from "@/lib/api";
import { contarRascunhosNota, listarMutacoesPendentes, obterEstadoOffline, type EstadoOffline, type MutacaoPendente } from "@/lib/offline-store";
import { descreverMutacao } from "@/lib/descrever-mutacao";
import { formatDataHoraCompleta } from "@/lib/format";
import { useRefreshBus } from "@/lib/refresh-bus";
import { avisar } from "@/lib/toast";
import { useConfirmar } from "@/components/common/useConfirmar";
import { Cabecalho } from "./campos-config";

const BOTAO = "flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-xs font-medium text-text-primary hover:bg-surface-3 disabled:opacity-40";

/**
 * Tudo que está esperando para chegar ao servidor ou que precisa de uma decisão: as alterações feitas sem conexão
 * (uma a uma: tentar de novo, abrir o item, copiar o texto, descartar) e os problemas de sincronização do calendário
 * e de arquivos, que têm telas próprias. O aviso "Sincronização pendente" do topo traz para cá.
 */
export function PendenciasScreen() {
  const navigate = useNavigate();
  const { notificar } = useRefreshBus();
  const { confirmar, dialogo } = useConfirmar();
  const [fila, setFila] = useState<MutacaoPendente[] | null>(null);
  const [estado, setEstado] = useState<EstadoOffline>(obterEstadoOffline);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [outros, setOutros] = useState<{ calendario: number | null; arquivos: number | null; rascunhos: number }>({ calendario: null, arquivos: null, rascunhos: 0 });

  const carregar = useCallback(async () => {
    setFila(await listarMutacoesPendentes());
    setEstado(obterEstadoOffline());
  }, []);

  // Com esta tela aberta, o aviso do topo some (ele só trazia para cá e cobria o título).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("ecos:pendencias-aberta", { detail: true }));
    return () => { window.dispatchEvent(new CustomEvent("ecos:pendencias-aberta", { detail: false })); };
  }, []);

  useEffect(() => {
    void carregar();
    const aoMudar = () => { void carregar(); };
    window.addEventListener("ecos:offline-change", aoMudar);
    return () => window.removeEventListener("ecos:offline-change", aoMudar);
  }, [carregar]);

  useEffect(() => {
    let vivo = true;
    void Promise.all([
      problemasSync.listar().then((r) => r.items.length).catch(() => null),
      problemasArquivos.listar().then((r) => r.itens.length).catch(() => null),
      contarRascunhosNota().catch(() => 0),
    ]).then(([calendario, arquivos, rascunhos]) => { if (vivo) setOutros({ calendario, arquivos, rascunhos }); });
    return () => { vivo = false; };
  }, []);

  async function tentar(m: MutacaoPendente) {
    setOcupado(m.id);
    const r = await enviarMutacaoPendente(m.id);
    setOcupado(null);
    if (r.ok) { notificar(); avisar("Alteração enviada.", "sucesso"); } else avisar(r.erro, "erro");
    await carregar();
  }

  async function tentarTodas() {
    setOcupado("todas");
    const enviadas = await sincronizarPendenciasOffline();
    setOcupado(null);
    if (enviadas > 0) { notificar(); avisar(`${enviadas} ${enviadas === 1 ? "alteração enviada" : "alterações enviadas"}.`, "sucesso"); }
    await carregar();
  }

  async function descartar(m: MutacaoPendente) {
    const d = descreverMutacao(m);
    const ok = await confirmar({
      title: `Descartar “${d.titulo || d.acao}”?`,
      description: `${d.acao} feita neste aparelho não será enviada. O que está no servidor continua como está.${d.texto ? " Se quiser guardar o texto, copie antes." : ""}`,
      confirmLabel: "Descartar",
    });
    if (!ok) return;
    await descartarMutacaoPendente(m.id);
    notificar();
    await carregar();
  }

  async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); avisar("Texto copiado.", "sucesso"); } catch { avisar("Não foi possível copiar.", "erro"); }
  }

  const vazio = fila !== null && fila.length === 0;
  const comErro = fila?.filter((m) => m.erro).length ?? 0;

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      {dialogo}
      <Cabecalho titulo="Pendências" />

      <section className="mb-6" aria-labelledby="pend-fila">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="pend-fila" className="text-xs font-semibold uppercase tracking-wide text-text-muted">Alterações deste aparelho</h2>
          {!vazio && fila && <button type="button" className={BOTAO} disabled={ocupado !== null || !estado.servidorDisponivel} onClick={() => void tentarTodas()}><RefreshCw size={13} className={ocupado === "todas" ? "animate-spin motion-reduce:animate-none" : ""} />Enviar todas</button>}
        </div>
        {!estado.servidorDisponivel && <p className="mb-2 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"><WifiOff size={15} />Sem conexão com o servidor. As alterações ficam guardadas aqui até voltar.</p>}
        {fila === null ? <p className="text-sm text-text-muted" role="status">Carregando…</p>
          : vazio ? <p className="flex items-center gap-2 rounded-2xl border border-border bg-surface-1 px-4 py-4 text-sm text-text-secondary"><CheckCircle2 size={17} className="text-success" />Tudo enviado. Nenhuma alteração esperando.</p>
          : <>
            <p className="mb-2 text-xs text-text-muted">São enviadas na ordem em que foram feitas. {comErro > 0 ? "Uma alteração recusada pelo servidor segura as seguintes: tente de novo ou descarte para liberar a fila." : ""}</p>
            <ul className="flex flex-col gap-2">
              {fila.map((m, i) => {
                const d = descreverMutacao(m);
                return (
                  <li key={m.id} className={`rounded-2xl border bg-surface-1 px-4 py-3 ${m.erro ? "border-warning/50" : "border-border"}`}>
                    <div className="flex items-start gap-3">
                      {m.erro ? <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warning" aria-label="Recusada" /> : <CloudUpload size={17} className="mt-0.5 shrink-0 text-steel-300" aria-label="Esperando envio" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text-primary">{d.acao}{d.titulo && <span className="text-text-secondary"> · “{d.titulo}”</span>}</p>
                        <p className="text-xs text-text-muted">{i + 1}º na fila · feita em {formatDataHoraCompleta(new Date(m.criadaEm).toISOString())}</p>
                        {m.erro && <p className="mt-1 text-xs text-warning">O servidor respondeu: {m.erro}</p>}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 pl-8">
                      <button type="button" className={BOTAO} disabled={ocupado !== null || !estado.servidorDisponivel} onClick={() => void tentar(m)}><RefreshCw size={13} className={ocupado === m.id ? "animate-spin motion-reduce:animate-none" : ""} />Tentar agora</button>
                      {d.rota && <button type="button" className={BOTAO} onClick={() => navigate(d.rota!)}><SquareArrowOutUpRight size={13} />Abrir</button>}
                      {d.texto && <button type="button" className={BOTAO} onClick={() => void copiar(d.texto!)}><Copy size={13} />Copiar texto</button>}
                      <button type="button" className={`${BOTAO} !text-error`} disabled={ocupado !== null} onClick={() => void descartar(m)}><Trash2 size={13} />Descartar</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>}
      </section>

      <section aria-labelledby="pend-outros">
        <h2 id="pend-outros" className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">No servidor</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface-1">
          <ItemOutro para="/configuracoes/calendario/problemas" Icone={CalendarX2} titulo="Sincronização do calendário" total={outros.calendario} />
          <ItemOutro para="/configuracoes/arquivos/problemas" Icone={FileWarning} titulo="Arquivos fora do padrão" total={outros.arquivos} />
        </div>
        {outros.rascunhos > 0 && <p className="mt-3 text-xs text-text-muted">{outros.rascunhos === 1 ? "1 nota tem" : `${outros.rascunhos} notas têm`} rascunho guardado neste aparelho (texto que não chegou a ser salvo). Ele aparece ao abrir a nota.</p>}
      </section>
    </div>
  );
}

function ItemOutro({ para, Icone, titulo, total }: { para: string; Icone: typeof CalendarX2; titulo: string; total: number | null }) {
  const descricao = total === null ? "Não foi possível verificar agora." : total === 0 ? "Nada a resolver." : `${total} ${total === 1 ? "item para resolver" : "itens para resolver"}.`;
  return (
    <Link to={para} className="flex min-h-16 items-center gap-3 border-b border-border/60 px-4 py-3 text-sm last:border-0 hover:bg-surface-2">
      <Icone size={18} className={`shrink-0 ${total ? "text-warning" : "text-steel-300"}`} />
      <span className="min-w-0 flex-1"><span className="block font-medium text-text-primary">{titulo}</span><span className="block text-xs text-text-muted">{descricao}</span></span>
      {!!total && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">{total}</span>}
      <ChevronRight size={16} className="text-text-muted" />
    </Link>
  );
}
