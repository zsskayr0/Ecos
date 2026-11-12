import { useRef, useState, type PointerEvent as PointerReact } from "react";
import { CalendarClock, Check, CheckCircle2, ListChecks, RotateCcw, Trash2, X } from "lucide-react";
import { tarefas as tarefasApi, type TarefaResumo } from "@/lib/api";
import { dataLocalISO, diaEMinutosLocais, instanteLocalISO, somarDiasISO } from "@/lib/agenda-tempo";
import { formatDuracao } from "@/lib/format";
import { avisarExcluido } from "@/lib/desfazer";
import { definirStatusOtimista } from "@/lib/status-otimista";
import { useRefreshBus } from "@/lib/refresh-bus";
import { mensagemDeErro } from "@/lib/erros";
import { Dialog } from "@/components/common/Dialog";
import { DatePicker } from "@/components/common/DatePicker";

type AbrirDocumento = (caminho: string, evento?: import("react").MouseEvent<HTMLElement>) => void;

/** Largura das ações reveladas ao arrastar para a esquerda (Mover + Apagar) e o quanto arrastar para a direita para concluir. */
const LARGURA_ACOES = 144;
const LIMITE_CONCLUIR = 96;

/**
 * Cartão de tarefa do resumo do dia, com gestos (toque ou mouse): arrastar para a direita conclui (ou reabre, se já
 * estava concluída); arrastar para a esquerda revela Mover para outro dia e Apagar. Tocar no cartão abre a tarefa.
 */
export function CartaoTarefa({ tarefa, abrirDocumento }: { tarefa: TarefaResumo; abrirDocumento: AbrirDocumento }) {
  const { notificar } = useRefreshBus();
  const hora = tarefa.scheduled_at ? new Date(tarefa.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "sem horário";
  const concluida = tarefa.status === "concluida";
  const [dx, setDx] = useState(0);
  const dxAtual = useRef(0);
  const [arrastando, setArrastando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [movendo, setMovendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Resposta visual: o cartão sai (apagar/mover) ou pisca (concluir/reabrir) antes de a lista recarregar.
  const [saindo, setSaindo] = useState<"apagar" | "mover" | null>(null);
  const [resposta, setResposta] = useState<string | null>(null);
  const esperar = (ms: number) => new Promise((ok) => window.setTimeout(ok, ms));
  const gesto = useRef<{ x0: number; y0: number; base: number; decidido: boolean } | null>(null);
  const engolir = useRef(false);

  const mover = (valor: number) => { dxAtual.current = valor; setDx(valor); };

  function aoPressionar(e: PointerReact<HTMLElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    gesto.current = { x0: e.clientX, y0: e.clientY, base: aberto ? -LARGURA_ACOES : 0, decidido: false };
  }
  function aoMover(e: PointerReact<HTMLElement>) {
    const g = gesto.current;
    if (!g) return;
    const dxm = e.clientX - g.x0;
    const dym = e.clientY - g.y0;
    if (!g.decidido) {
      if (Math.abs(dym) > 8 && Math.abs(dym) > Math.abs(dxm)) { gesto.current = null; return; }
      if (Math.abs(dxm) < 8) return;
      g.decidido = true;
      setArrastando(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    mover(Math.max(-LARGURA_ACOES - 24, Math.min(LIMITE_CONCLUIR + 48, g.base + dxm)));
  }
  function aoSoltar() {
    const g = gesto.current;
    gesto.current = null;
    if (!g?.decidido) return;
    engolir.current = true;
    setArrastando(false);
    const final = dxAtual.current;
    if (final >= LIMITE_CONCLUIR) { setAberto(false); mover(0); void alternarConclusao(); return; }
    if (final <= -LARGURA_ACOES / 2) { setAberto(true); mover(-LARGURA_ACOES); return; }
    setAberto(false);
    mover(0);
  }
  const fechar = () => { setAberto(false); mover(0); };

  async function alternarConclusao() {
    const proximo = concluida ? "pendente" : "concluida";
    const reverter = definirStatusOtimista([tarefa.id], proximo);
    setResposta(proximo === "concluida" ? "Concluída" : "Reaberta");
    window.setTimeout(() => setResposta(null), 1100);
    try { await tarefasApi.atualizarStatus(tarefa.id, proximo); notificar(); }
    catch (e) { reverter(); setResposta(null); setErro(mensagemDeErro(e, "Não foi possível atualizar a tarefa.")); }
  }
  async function apagar() {
    setSaindo("apagar");
    await esperar(260);
    try { await tarefasApi.excluir(tarefa.id); notificar(); avisarExcluido("tarefa", tarefa.titulo, notificar); }
    catch (e) { setSaindo(null); fechar(); setErro(mensagemDeErro(e, "Não foi possível apagar a tarefa.")); }
  }
  /** Mesma regra da tela Hoje: a tarefa com horário mantém a hora no dia novo; com prazo (ou sem nenhuma data) leva o prazo. */
  async function reagendar(dia: string) {
    setMovendo(false);
    setSaindo("mover");
    await esperar(260);
    const payload: { due_date?: string; scheduled_at?: string } = {};
    if (tarefa.scheduled_at) payload.scheduled_at = instanteLocalISO(dia, diaEMinutosLocais(tarefa.scheduled_at).minutos);
    if (tarefa.due_date || !tarefa.scheduled_at) payload.due_date = dia;
    try { await tarefasApi.atualizar(tarefa.id, payload); notificar(); }
    catch (e) { setSaindo(null); fechar(); setErro(mensagemDeErro(e, "Não foi possível mover a tarefa.")); }
  }

  const hoje = dataLocalISO(new Date());
  const botaoAcao = "group flex h-full flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-white transition-[filter,transform] duration-150 hover:brightness-110 active:scale-95 active:brightness-90";
  // Os ícones das ações crescem conforme o cartão é arrastado; o da direita "arma" (cresce mais e muda a cor) ao passar do limite.
  const revelado = Math.min(1, Math.max(0, -dx / LARGURA_ACOES));
  const armado = dx >= LIMITE_CONCLUIR;
  return (
    <div className="relative overflow-hidden rounded-2xl" style={{ maxHeight: saindo ? 0 : 160, opacity: saindo ? 0 : 1, transition: "max-height 260ms cubic-bezier(0.4, 0, 0.2, 1) 60ms, opacity 200ms ease-out" }}>
      <div aria-hidden className={`absolute inset-y-0 left-0 flex items-center pl-5 transition-colors duration-150 ${armado ? "bg-success text-white" : "bg-success/25 text-success"} ${dx > 0 ? "opacity-100" : "opacity-0"}`} style={{ width: Math.max(0, dx) }}>
        <span className="transition-transform duration-150" style={{ transform: `scale(${armado ? 1.3 : Math.min(1, dx / LIMITE_CONCLUIR)})` }}>{concluida ? <RotateCcw size={20} /> : <Check size={20} />}</span>
      </div>
      <div className="absolute inset-y-0 right-0 flex" style={{ width: LARGURA_ACOES }} aria-hidden={!aberto}>
        <button type="button" tabIndex={aberto ? 0 : -1} onClick={() => setMovendo(true)} aria-label={`Mover ${tarefa.titulo} para outro dia`} className={`${botaoAcao} bg-steel-700`}><CalendarClock size={18} className="transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-6" style={{ transform: aberto ? undefined : `scale(${0.6 + 0.4 * revelado})`, opacity: 0.4 + 0.6 * revelado }} />Mover</button>
        <button type="button" tabIndex={aberto ? 0 : -1} onClick={() => void apagar()} aria-label={`Apagar ${tarefa.titulo}`} className={`${botaoAcao} bg-error`}><Trash2 size={18} className="transition-transform duration-200 group-hover:scale-110 group-hover:rotate-6" style={{ transform: aberto ? undefined : `scale(${0.6 + 0.4 * revelado})`, opacity: 0.4 + 0.6 * revelado }} />Apagar</button>
      </div>
      <button
        type="button"
        onClick={(e) => {
          if (engolir.current) { engolir.current = false; return; }
          if (aberto) { fechar(); return; }
          abrirDocumento(`/tarefa/${tarefa.id}`, e);
        }}
        onPointerDown={aoPressionar} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar}
        style={{ transform: saindo ? "translateX(-110%)" : `translateX(${dx}px)`, transition: arrastando ? "none" : "transform 240ms cubic-bezier(0.4, 0, 0.2, 1), background-color 150ms", touchAction: "pan-y", userSelect: "none" }}
        className="relative flex w-full items-center gap-3 rounded-2xl bg-surface-1 p-3.5 text-left [@media(hover:hover)]:hover:bg-surface-2 active:bg-surface-2"
      >
        {concluida ? <CheckCircle2 size={18} strokeWidth={1.75} className="shrink-0 text-success" /> : <ListChecks size={18} strokeWidth={1.75} className={`shrink-0 ${tarefa.prioridade === "alta" ? "text-error" : "text-cyan"}`} />}
        <div className="min-w-0 flex-1"><p className={`truncate text-[15px] font-medium ${concluida ? "text-text-muted line-through" : "text-text-primary"}`}>{tarefa.titulo}</p><p className="font-mono-value text-xs text-text-muted">{hora} {tarefa.duration_min ? `· ${formatDuracao(tarefa.duration_min)}` : ""}</p></div>
      </button>
      {resposta && <div aria-live="polite" className="ecos-fade-in pointer-events-none absolute inset-0 flex items-center justify-center gap-2 rounded-2xl bg-success/20 text-sm font-semibold text-success"><CheckCircle2 size={18} />{resposta}</div>}
      {erro && <p role="alert" className="mt-1 flex items-start gap-1 px-2 text-xs text-error"><span className="min-w-0 flex-1">{erro}</span><button type="button" aria-label="Dispensar aviso" onClick={() => setErro(null)}><X size={12} /></button></p>}
      {movendo && (
        <Dialog rotulo="Mover para outro dia" onFechar={() => setMovendo(false)} className="fixed inset-0 z-[80] flex items-end bg-black/50">
          <div className="w-full rounded-t-2xl border-t border-border bg-surface-1 pb-[env(safe-area-inset-bottom)]">
            <header className="flex items-center justify-between px-4 py-3"><h2 className="truncate text-base font-semibold text-text-primary">Mover para…</h2><button type="button" onClick={() => setMovendo(false)} aria-label="Fechar" className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted"><X size={19} /></button></header>
            <div className="flex flex-wrap items-center gap-2 px-4 pb-5">
              {[["Hoje", 0], ["Amanhã", 1], ["Em 7 dias", 7]].map(([rotulo, n]) => (
                <button key={rotulo} type="button" onClick={() => void reagendar(somarDiasISO(hoje, n as number))} className="h-11 rounded-xl border border-border px-4 text-sm text-text-primary active:bg-surface-2">{rotulo}</button>
              ))}
              <DatePicker accent="cyan" ariaLabel="Outra data" value={tarefa.scheduled_at ? dataLocalISO(new Date(tarefa.scheduled_at)) : tarefa.due_date ?? hoje} onChange={(v) => v && void reagendar(v)} />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
