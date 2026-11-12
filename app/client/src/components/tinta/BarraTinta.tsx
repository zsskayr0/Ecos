/** Barra do Modo de escrita: ferramentas, cor, espessura, desfazer/refazer, dedo e limpar. */
import { useRef } from "react";
import { Eraser, Highlighter, Lasso, PenTool, Redo2, Scissors, Spline, Undo2 } from "lucide-react";
import { ControleEspessura } from "./ControleEspessura";
import { Colapso } from "./Colapso";
import { SeletorPaleta, type LadoPaleta } from "./SeletorPaleta";
import type { FerramentaUI, ModoBorracha, Pincel } from "./ColunaTinta";

export const CORES_CANETA = [
  { valor: "auto", rotulo: "Cor do texto", cor: "rgb(var(--ecos-text-primary-rgb))" },
  { valor: "#2563eb", rotulo: "Azul", cor: "#2563eb" },
  { valor: "#dc2626", rotulo: "Vermelho", cor: "#dc2626" },
  { valor: "#16a34a", rotulo: "Verde", cor: "#16a34a" },
  { valor: "#9333ea", rotulo: "Roxo", cor: "#9333ea" },
] as const;

export const CORES_MARCA = [
  { valor: "#facc15", rotulo: "Amarelo", cor: "#facc15" },
  { valor: "#4ade80", rotulo: "Verde", cor: "#4ade80" },
  { valor: "#f472b6", rotulo: "Rosa", cor: "#f472b6" },
  { valor: "#60a5fa", rotulo: "Azul", cor: "#60a5fa" },
] as const;

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
  onModoBorracha: (modo: ModoBorracha) => void;
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

export function BarraTinta({ pincel, onPincel, onCor, onEspessura, onModoBorracha, podeDesfazer, podeRefazer, onDesfazer, onRefazer, ehMobile, vertical = false, alinhar = "esq", embaixo = false }: Props) {
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
  const desenhando = pincel.ferramenta !== "borracha" && pincel.ferramenta !== "laco";
  const cores = pincel.ferramenta === "marca-texto" ? CORES_MARCA : CORES_CANETA;
  const corDoPincel = pincel.cor === "auto" ? "rgb(var(--ecos-text-primary-rgb))" : pincel.cor;
  const classeMenu = `${ehMobile ? "h-10" : "h-8"} flex items-center gap-1.5 rounded-lg pl-2 pr-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 disabled:opacity-40`;

  return (
    <div ref={trilho} className={`ecos-fade-in flex min-w-0 items-center gap-0.5 ${vertical ? "flex-col" : "flex-nowrap overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"}`} role="group" aria-label="Ferramentas de escrita"
      onPointerDown={aoPressionar} onPointerMove={aoArrastar} onPointerUp={aoSoltarTrilho} onPointerCancel={aoSoltarTrilho} onClickCapture={(e) => { if (arrasto.current?.moveu) { e.stopPropagation(); e.preventDefault(); } }}>
      {ferramenta("caneta", PenTool, "Caneta")}
      {ferramenta("marca-texto", Highlighter, "Marca-texto")}
      {ferramenta("borracha", Eraser, "Borracha")}
      {ferramenta("laco", Lasso, "Seleção por laço (mover, ampliar, apagar)")}
      {separador}
      <Colapso aberto={desenhando} vertical={vertical}><div className={`flex items-center gap-0.5 ${vertical ? "flex-col" : ""}`}>
        <SeletorPaleta ariaLabel="Cor" valor={pincel.cor} onChange={onCor} lado={lado} classeGatilho={classeMenu}
          opcoes={cores.map((c) => ({ valor: c.valor, rotulo: c.rotulo, conteudo: <span aria-hidden className="h-[18px] w-[18px] rounded-full border border-border" style={{ backgroundColor: c.cor }} /> }))}
          gatilho={<span aria-hidden className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: cores.find((c) => c.valor === pincel.cor)?.cor }} />} />
        <SeletorPaleta ariaLabel="Espessura" valor={String(pincel.espessura)} lado={lado} classeGatilho={classeMenu}
          conteudoAba={pincel.ferramenta === "borracha" || pincel.ferramenta === "laco" ? null : <ControleEspessura ferramenta={pincel.ferramenta} cor={corDoPincel} valor={pincel.espessura} onChange={onEspessura} />}
          gatilho={vertical ? <span aria-hidden className="w-4 rounded-full bg-text-secondary" style={{ height: linhaEspessura(pincel.espessura, pincel.ferramenta) }} /> : <span className="tabular-nums">{String(pincel.espessura).replace(".", ",")} px</span>} />
        {separador}
      </div></Colapso>
      <Colapso aberto={pincel.ferramenta === "borracha"} vertical={vertical}><div className={`flex items-center gap-0.5 ${vertical ? "flex-col" : ""}`}>
        {modo("traco", Spline, "Borracha de traço (apaga o traço inteiro)")}
        {modo("trecho", Scissors, "Borracha de trecho (apaga só a parte tocada)")}
        {separador}
      </div></Colapso>
      {acao(Undo2, "Desfazer (Ctrl+Z)", onDesfazer, !podeDesfazer)}
      {acao(Redo2, "Refazer (Ctrl+Y)", onRefazer, !podeRefazer)}
    </div>
  );
}
