import { createPortal } from "react-dom";
import "@/components/common/menu-suspenso.css";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Ellipsis, X, FileDown, History, Keyboard } from "lucide-react";
import { useEscFecha } from "@/components/common/Dialog";
import { TempoEdicao } from "@/components/common/TempoEdicao";
import { formatDataHoraCompleta } from "@/lib/format";
import { FORMATOS_EXPORTACAO, exportarNota, type FormatoExportacao } from "@/lib/exportar-nota";
import { avisar } from "@/lib/toast";
import { mensagemDeErro } from "@/lib/erros";

interface Props {
  criadoEm: string;
  atualizadoEm: string;
  /** Texto do estado de gravação ("Salvo", "Salvando…"). */
  estado: string;
  erro?: boolean;
  revisada: boolean;
  onRevisar: () => void;
  /** Gera o PDF da nota (abre a impressão do sistema). */
  onExportarPdf?: () => void;
  /** Id da nota: mostra "Exportar como" (.md, .html, .docx, .tex). */
  notaId?: string;
  /** Abre o painel "Histórico" (versões anteriores guardadas pelo servidor). */
  onHistorico?: () => void;
  /** Anexos da nota. Fica montado mesmo com o painel fechado, para um envio em andamento não ser cancelado. */
  anexos?: ReactNode;
  /** Ações da nota (copiar caminho, apagar…) listadas no fim do menu. Quem as passa fecha o menu se precisar: elas recebem `fechar`. */
  acoes?: (fechar: () => void) => ReactNode;
  /** Classes do botão (tamanho/borda variam entre mobile, desktop e Focus). */
  classeBotao: string;
  /** Desktop: menu suspenso compacto preso ao botão, em vez do painel com véu (celular). */
  menu?: boolean;
  /** Menu sem o rodapé de datas/estado (quando o painel lateral já mostra Informações). */
  semRodape?: boolean;
  /** Nome do menu (botão e leitores de tela). */
  rotulo?: string;
  /** Sem o espaço onde o editor da nota coloca folha, tela cheia e imprimir (ex.: tarefas). */
  semSlotEditor?: boolean;
}

async function exportarComo(id: string, formato: FormatoExportacao) {
  try { await exportarNota(id, formato); } catch (e) { avisar(mensagemDeErro(e, "Não foi possível exportar a nota."), "erro"); }
}

/** Menu "⋯" da nota: anexos e informações (criação, edição, estado), que antes ficavam soltos abaixo do editor. */
export function OpcoesNota({ criadoEm, atualizadoEm, estado, erro = false, revisada, onRevisar, onExportarPdf, notaId, onHistorico, anexos, acoes, classeBotao, menu = false, semRodape = false, rotulo = "Opções da nota", semSlotEditor = false }: Props) {
  const [aberto, setAberto] = useState(false);
  const titulo = useId();
  useEscFecha(aberto, () => setAberto(false));
  const botao = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Com o painel aberto (celular), a nota por baixo fica parada: roda e toque fora dele não rolam a página.
  const fundo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = fundo.current;
    if (menu || !aberto || !el) return;
    const travar = (e: Event) => { if (!(e.target instanceof Node) || !el.firstElementChild?.contains(e.target)) e.preventDefault(); };
    el.addEventListener("wheel", travar, { passive: false });
    el.addEventListener("touchmove", travar, { passive: false });
    return () => { el.removeEventListener("wheel", travar); el.removeEventListener("touchmove", travar); };
  }, [aberto, menu]);
  // Menu (desktop): clicar fora fecha. Menus e diálogos abertos de dentro (em portal) não contam como fora.
  useEffect(() => {
    if (!menu || !aberto) return;
    const fora = (e: MouseEvent) => {
      const t = e.target as Element;
      if (caixa.current?.contains(t) || botao.current?.contains(t)) return;
      if (t.closest?.("[role=menu],[role=listbox],[role=dialog]")) return;
      setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [menu, aberto]);
  // Itens que o editor da nota coloca aqui (ex.: "Limpar anotações") fecham o menu antes de abrir o próprio diálogo.
  useEffect(() => {
    const fechar = () => setAberto(false);
    document.addEventListener("ecos:fechar-opcoes-nota", fechar);
    return () => document.removeEventListener("ecos:fechar-opcoes-nota", fechar);
  }, []);

  const abrir = () => {
    if (!menu) { setAberto(true); return; }
    const r = botao.current?.getBoundingClientRect();
    // Centrado sob o botão, sem sair da tela (largura do menu: 288px).
    if (r) setPos({ top: r.bottom + 6, left: Math.min(Math.max(8, r.left + r.width / 2 - 144), window.innerWidth - 296) });
    setAberto((v) => !v);
  };

  if (menu) {
    // Desktop: menu suspenso compacto preso ao botão, sem véu nem desfoque.
    // Uma linha por ação; exportação numa linha só; datas e estado no rodapé.
    const linha = "ecos-menu-item flex min-h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary";
    const chip = "rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary";
    const separador = <div aria-hidden className="my-1 border-t border-border" />;
    return <>
      <button ref={botao} type="button" aria-haspopup="menu" aria-expanded={aberto} aria-label={rotulo} title={rotulo} onClick={abrir} className={classeBotao}><Ellipsis size={18} /></button>
      {createPortal(<div ref={caixa} role="menu" aria-label={rotulo} aria-hidden={!aberto || undefined} {...(aberto ? {} : ({ inert: "" } as object))}
        data-alinhar="centro" data-saindo={!aberto}
        // Mesma entrada/saída dos menus do Ecos (ecos-menu: desce e se desdobra); fechado, some fora da tela.
        className={`ecos-menu fixed z-[900] max-h-[80vh] w-72 overflow-y-auto rounded-xl border border-border bg-surface-1 p-1.5 shadow-nav ${pos ? "" : "invisible"}`}
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
        {acoes && <div className="flex flex-col [&>*]:!min-h-8 [&>*]:!gap-2.5 [&>*]:!rounded-md [&>*]:!border-0 [&>*]:!px-2.5 [&>*]:!text-[13px]">{acoes(() => setAberto(false))}</div>}
        {onHistorico && <button type="button" onClick={() => { setAberto(false); onHistorico(); }} className={linha}><History size={15} />Histórico de versões</button>}
        {!revisada && <button type="button" onClick={() => { onRevisar(); setAberto(false); }} className={linha}><CheckCircle2 size={15} />Marcar como revisada</button>}
        <button type="button" onClick={() => { setAberto(false); window.dispatchEvent(new Event("ecos:atalhos-editor")); }} className={linha}><Keyboard size={15} />Atalhos do teclado</button>
        {(onExportarPdf || notaId) && <>{separador}<div className="px-2.5 py-1.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Exportar como</p>
          <div className="flex flex-wrap gap-1">
            {onExportarPdf && <button type="button" onClick={() => { setAberto(false); onExportarPdf(); }} className={chip}>PDF</button>}
            {notaId && FORMATOS_EXPORTACAO.map(({ formato, rotulo }) => <button key={formato} type="button" title={rotulo} onClick={() => { setAberto(false); void exportarComo(notaId, formato); }} className={chip}>.{formato}</button>)}
          </div>
        </div></>}
        {/* O editor coloca aqui folha, tela cheia e imprimir. */}
        {!semSlotEditor && <div data-slot-opcoes-escrita data-compacto="" className="empty:hidden [&:not(:empty)]:mt-1 [&:not(:empty)]:border-t [&:not(:empty)]:border-border [&:not(:empty)]:pt-1" />}
        {anexos && <>{separador}<section aria-label="Anexos" className="px-1 py-1">{anexos}</section></>}
        {!semRodape && separador}
        {!semRodape && <p className="px-2.5 pb-1 pt-0.5 text-[11px] leading-relaxed text-text-muted">
          Criada em {formatDataHoraCompleta(criadoEm)} · editada <TempoEdicao iso={atualizadoEm} /> · <span aria-live="polite" className={erro ? "text-error" : ""}>{estado}</span>
        </p>}
      </div>, document.body)}
    </>;
  }

  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={aberto} aria-label={rotulo} title={rotulo} onClick={abrir} className={classeBotao}><Ellipsis size={18} /></button>
    {createPortal(<div ref={fundo} role="dialog" aria-modal={aberto || undefined} aria-labelledby={titulo} aria-hidden={!aberto || undefined} {...(aberto ? {} : ({ inert: "" } as object))}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setAberto(false); }}
      className={`fixed inset-0 z-[900] flex touch-none items-center justify-center overflow-hidden overscroll-contain bg-black/40 p-4 backdrop-blur-md transition-[opacity,visibility] duration-300 ease-out motion-reduce:transition-none ${aberto ? "visible opacity-100" : "invisible opacity-0"}`}>
      <div className={`max-h-[85vh] w-full max-w-md touch-pan-y space-y-5 overflow-y-auto overscroll-contain rounded-2xl border border-steel-400/25 bg-surface-1/80 p-5 shadow-[0_24px_64px_rgb(0_0_0/0.5)] backdrop-blur-xl backdrop-saturate-150 transition-[transform,opacity] duration-[380ms] ease-[cubic-bezier(0.2,0.9,0.25,1.1)] motion-reduce:transition-none ${aberto ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-95 opacity-0"}`}>
        <div className="flex items-center justify-between gap-3">
          <h2 id={titulo} className="font-display text-lg font-semibold text-text-primary">Opções da nota</h2>
          <button type="button" aria-label="Fechar" onClick={() => setAberto(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-3 hover:text-text-primary"><X size={17} /></button>
        </div>
        {anexos && <section aria-label="Anexos">{anexos}</section>}
        <section aria-label="Informações" className="space-y-2 border-t border-border pt-4 text-sm text-text-secondary">
          <p>Criada em {formatDataHoraCompleta(criadoEm)}</p>
          <p>Editada <TempoEdicao iso={atualizadoEm} /></p>
          <p aria-live="polite" className={erro ? "text-error" : "text-text-muted"}>{estado}</p>
          {onExportarPdf && <button type="button" onClick={() => { setAberto(false); onExportarPdf(); }} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-3 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"><FileDown size={16} />Exportar PDF</button>}
          {notaId && <div role="group" aria-label="Exportar como" className="space-y-1.5 pt-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Exportar como</p>
            <div className="flex flex-wrap gap-2">{FORMATOS_EXPORTACAO.map(({ formato, rotulo }) => <button key={formato} type="button" title={rotulo}
              onClick={() => { setAberto(false); void exportarComo(notaId, formato); }}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-border px-3 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"><FileDown size={15} />.{formato}</button>)}</div>
          </div>}
          {onHistorico && <button type="button" onClick={() => { setAberto(false); onHistorico(); }} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-3 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"><History size={16} />Histórico</button>}
          {!revisada && <button type="button" onClick={() => { onRevisar(); setAberto(false); }} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-3 text-steel-300 transition-colors hover:bg-surface-2 hover:text-text-primary"><CheckCircle2 size={16} />Marcar revisada</button>}
        </section>
        <section aria-label="Escrita e folha" data-slot-opcoes-escrita className="space-y-4 border-t border-border pt-4 empty:hidden" />
        {acoes && <section aria-label="Ações" className="space-y-2 border-t border-border pt-4">{acoes(() => setAberto(false))}</section>}
      </div>
    </div>, document.body)}
  </>;
}
