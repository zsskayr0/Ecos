/** Barra do Modo de escrita: ferramentas, cor, espessura, desfazer/refazer, dedo e limpar. */
import { useEffect, useRef } from "react";
import { Eraser, Highlighter, Lasso, PenTool, Redo2, Scissors, Spline, Undo2 } from "lucide-react";
import { ControleEspessura } from "./ControleEspessura";
import { SeletorCor } from "./SeletorCor";
import { useSlotsCor } from "@/lib/tinta/paletas";
import { Colapso } from "./Colapso";
import { SeletorPaleta, type LadoPaleta } from "./SeletorPaleta";
import type { FerramentaUI, ModoBorracha, Pincel } from "./ColunaTinta";

export const ESPESSURAS = {
  caneta: [{ valor: "1.5", rotulo: "Fina" }, { valor: "2.5", rotulo: "Média" }, { valor: "4", rotulo: "Grossa" }],
  "marca-texto": [{ valor: "10", rotulo: "Fino" }, { valor: "16", rotulo: "Médio" }, { valor: "24", rotulo: "Largo" }],
} as const;

const linhaEspessura = (v: number, f: string) => Math.min(8, Math.max(2, f === "marca-texto" ? v / 3 : v * 1.2));

interface Props {
  pincel: Pincel;
  /** Cor e espessura lembradas por ferramenta (trocar de caneta para marca-texto e voltar não perde a escolha). */
  onPincel: (ferramenta: FerramentaUI) => void;
  onCor: (cor: string) => void;
  onEspessura: (espessura: number) => void;
  onReta: (reta: boolean) => void;
  onTamanhoBorracha: (tamanho: number) => void;
  onModoBorracha: (modo: ModoBorracha) => void;
  onSoMarca: (v: boolean) => void;
  podeDesfazer: boolean;
  podeRefazer: boolean;
  onDesfazer: () => void;
  onRefazer: () => void;
  ehMobile: boolean;
  /** Paleta encaixada na lateral: ferramentas em coluna. */
  vertical?: boolean;
  alinhar?: "esq" | "dir";
  /** Paleta encaixada embaixo: as abas de cor e espessura abrem para cima. */
  embaixo?: boolean;
}

export function BarraTinta({ pincel, onPincel, onCor, onEspessura, onReta, onTamanhoBorracha, onModoBorracha, onSoMarca, podeDesfazer, podeRefazer, onDesfazer, onRefazer, ehMobile, vertical = false, alinhar = "esq", embaixo = false }: Props) {
  const tam = ehMobile ? "h-10 w-10" : "h-8 w-8";
  const separador = <span aria-hidden className={vertical ? "my-1 h-px w-5 bg-border" : "mx-1 h-5 w-px bg-border"} />;
  const ferramenta = (f: FerramentaUI, Icone: typeof PenTool, rotulo: string) => (
    <button type="button" aria-pressed={pincel.ferramenta === f} aria-label={rotulo} title={rotulo} onClick={() => onPincel(f)}
      className={`flex ${tam} shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${pincel.ferramenta === f ? "bg-steel-500/25 text-text-primary" : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"}`}>
      <Icone size={17} strokeWidth={1.75} />
    </button>
  );
  const acao = (Icone: typeof PenTool, rotulo: string, onClick: () => void, desabilitado = false, perigo = false) => (
    <button type="button" aria-label={rotulo} title={rotulo} disabled={desabilitado} onClick={onClick}
      className={`flex ${tam} shrink-0 items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 disabled:opacity-40 ${perigo ? "text-error hover:bg-error/15" : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"}`}>
      <Icone size={17} strokeWidth={1.75} />
    </button>
  );
  const modo = (m: ModoBorracha, Icone: typeof PenTool, rotulo: string) => (
    <button type="button" aria-pressed={(pincel.modoBorracha ?? "traco") === m} aria-label={rotulo} title={rotulo} onClick={() => onModoBorracha(m)}
      className={`flex ${tam} shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${(pincel.modoBorracha ?? "traco") === m ? "bg-steel-500/25 text-text-primary" : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"}`}>
      <Icone size={17} strokeWidth={1.75} />
    </button>
  );
  // Horizontal sem espaço: rola (sem barra visível) arrastando com o mouse; no toque o navegador já rola.
  const trilho = useRef<HTMLDivElement>(null);
  const arrasto = useRef<{ x: number; rolagem: number; id: number; moveu: boolean } | null>(null);
  const aoPressionar = (e: React.PointerEvent<HTMLDivElement>) => {
    if (vertical || e.pointerType !== "mouse" || e.button !== 0 || !trilho.current) return;
    arrasto.current = { x: e.clientX, rolagem: trilho.current.scrollLeft, id: e.pointerId, moveu: false };
  };
  const aoArrastar = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = arrasto.current, el = trilho.current;
    if (!a || !el || a.id !== e.pointerId) return;
    if (!a.moveu) { if (Math.abs(e.clientX - a.x) < 5) return; a.moveu = true; el.setPointerCapture(e.pointerId); }
    el.scrollLeft = a.rolagem - (e.clientX - a.x);
  };
  const aoSoltarTrilho = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = arrasto.current;
    if (!a || a.id !== e.pointerId) return;
    if (trilho.current?.hasPointerCapture(e.pointerId)) trilho.current.releasePointerCapture(e.pointerId);
    window.setTimeout(() => { arrasto.current = null; }, 0); // deixa o clique que sobra do arrasto passar pelo filtro abaixo
  };
  const lado: LadoPaleta = !vertical ? (embaixo ? "cima" : "baixo") : alinhar === "dir" ? "esquerda" : "direita";
  const borracha = pincel.ferramenta === "borracha";
  const valorEspessura = borracha ? pincel.tamanhoBorracha ?? 20 : pincel.espessura;
  const desenhando = pincel.ferramenta !== "borracha" && pincel.ferramenta !== "laco";
  const slots = useSlotsCor(pincel.ferramenta === "marca-texto" ? "marca-texto" : "caneta");
  // A cor da ferramenta é a do seletor ativo: ao trocar de ferramenta (ou abrir a barra) ela volta a ser a última escolhida ali.
  const corAtiva = slots.cores[slots.ativo]!;
  useEffect(() => { if (desenhando && pincel.cor !== corAtiva) onCor(corAtiva); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pincel.ferramenta]);
  const corDoPincel = pincel.cor === "auto" ? "rgb(var(--ecos-text-primary-rgb))" : pincel.cor;
  const classeMenu = `${ehMobile ? "h-10" : "h-8"} flex items-center gap-1.5 rounded-lg px-2 text-sm text-text-secondary transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 disabled:opacity-40`;

  return (
    <div ref={trilho} className={`ecos-fade-in flex min-w-0 items-center gap-0.5 ${vertical ? "flex-col" : "flex-nowrap overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"}`} role="group" aria-label="Ferramentas de escrita"
      onPointerDown={aoPressionar} onPointerMove={aoArrastar} onPointerUp={aoSoltarTrilho} onPointerCancel={aoSoltarTrilho} onClickCapture={(e) => { if (arrasto.current?.moveu) { e.stopPropagation(); e.preventDefault(); } }}>
      {ferramenta("caneta", PenTool, "Caneta")}
      <SeletorPaleta ariaLabel="Marca-texto" valor={pincel.reta ? "reta" : "circular"} onChange={(v) => onReta(v === "reta")} lado={lado} aoAbrir={() => { if (pincel.ferramenta !== "marca-texto") onPincel("marca-texto"); }}
        classeGatilho={`flex ${tam} shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${pincel.ferramenta === "marca-texto" ? "bg-steel-500/25 text-text-primary" : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"}`}
        opcoes={[
          { valor: "circular", rotulo: "Marca-texto circular", conteudo: <svg aria-hidden width="18" height="18" viewBox="0 0 18 18"><path d="M5 9h8" stroke="currentColor" strokeWidth="7" strokeLinecap="round" opacity="0.7" /></svg> },
          { valor: "reta", rotulo: "Marca-texto reto", conteudo: <svg aria-hidden width="18" height="18" viewBox="0 0 18 18"><path d="M3 9h12" stroke="currentColor" strokeWidth="7" strokeLinecap="butt" opacity="0.7" /></svg> },
        ]}
        gatilho={<Highlighter size={17} strokeWidth={1.75} />} />
      {ferramenta("borracha", Eraser, "Borracha")}
      {ferramenta("laco", Lasso, "Seleção por laço (mover, ampliar, apagar)")}
      {separador}
      <Colapso aberto={desenhando} vertical={vertical}><div className={`flex items-center gap-0.5 ${vertical ? "flex-col" : ""}`}>
        {slots.cores.map((cor, i) => {
          const ativo = slots.ativo === i;
          return (
            <SeletorPaleta key={i} ariaLabel={`Cor ${i + 1}`} valor={cor} lado={lado}
              grupo="cor-slots" ancora={i === 1} aoAbrir={() => { if (!ativo) { slots.ativar(i); onCor(cor); } }}
              classeGatilho={`flex ${ehMobile ? "h-10 w-9" : "h-8 w-7"} shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400`}
              conteudoAba={pincel.ferramenta === "borracha" || pincel.ferramenta === "laco" ? null : <SeletorCor ferramenta={pincel.ferramenta} valor={cor} onChange={(c) => { slots.definir(i, c); onCor(c); }} />}
              gatilho={<span aria-hidden className={`h-[18px] w-[18px] rounded-full border border-border transition-shadow ${ativo ? "ring-2 ring-steel-400 ring-offset-1 ring-offset-surface-1" : ""}`} style={{ backgroundColor: cor === "auto" ? "rgb(var(--ecos-text-primary-rgb))" : cor }} />} />
          );
        })}
      </div></Colapso>
      <Colapso aberto={desenhando || borracha} vertical={vertical}><div className={`flex items-center gap-0.5 ${vertical ? "flex-col" : ""}`}>
        <SeletorPaleta ariaLabel={borracha ? "Tamanho da borracha" : "Espessura"} valor={String(valorEspessura)} lado={lado} classeGatilho={classeMenu}
          conteudoAba={pincel.ferramenta === "laco" ? null : borracha
            ? <ControleEspessura ferramenta="borracha" cor={corDoPincel} valor={valorEspessura} onChange={onTamanhoBorracha} />
            : <ControleEspessura ferramenta={pincel.ferramenta} cor={corDoPincel} valor={pincel.espessura} onChange={onEspessura} reta={!!pincel.reta} />}
          gatilho={borracha
            ? <svg aria-hidden width="24" height="24" viewBox="0 0 24 24" className="text-text-secondary"><circle cx="12" cy="12" r={4.5 + ((valorEspessura - 4) / 28) * 6.5} fill="currentColor" fillOpacity={0.15} stroke="currentColor" strokeWidth={1.6} strokeDasharray="2.75 2.75" style={{ transition: "r 150ms ease-out" }} /></svg>
            : vertical ? <span aria-hidden className="w-4 rounded-full bg-text-secondary" style={{ height: linhaEspessura(pincel.espessura, pincel.ferramenta) }} /> : <span className="tabular-nums">{String(valorEspessura).replace(".", ",")} px</span>} />
        {separador}
      </div></Colapso>
      <Colapso aberto={pincel.ferramenta === "borracha"} vertical={vertical}><div className={`flex items-center gap-0.5 ${vertical ? "flex-col" : ""}`}>
        {modo("traco", Spline, "Borracha de traço (apaga o traço inteiro)")}
        {modo("trecho", Scissors, "Borracha de trecho (apaga só a parte tocada)")}
        <button type="button" aria-pressed={!!pincel.soMarca} aria-label="Apagar só marca-texto" title="Apagar só marca-texto" onClick={() => onSoMarca(!pincel.soMarca)}
          className={`flex ${tam} shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${pincel.soMarca ? "bg-steel-500/25 text-text-primary" : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"}`}><Highlighter size={17} strokeWidth={1.75} /></button>
        {separador}
      </div></Colapso>
      {acao(Undo2, "Desfazer (Ctrl+Z)", onDesfazer, !podeDesfazer)}
      {acao(Redo2, "Refazer (Ctrl+Y)", onRefazer, !podeRefazer)}
    </div>
  );
}
