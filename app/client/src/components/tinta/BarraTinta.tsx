/** Barra do Modo de escrita: ferramentas, cor, espessura, desfazer/refazer, dedo e limpar. */
import { ChevronDown, Eraser, Hand, Highlighter, PenTool, Redo2, Trash2, Undo2 } from "lucide-react";
import { MenuSuspenso } from "@/components/common/MenuSuspenso";
import type { EstadoGravacao } from "@/lib/tinta/use-tinta";
import type { FerramentaUI, Pincel } from "./ColunaTinta";

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

const ROTULO_ESTADO: Record<EstadoGravacao, string> = { ocioso: "", pendente: "Alterações pendentes", salvando: "Salvando…", salvo: "Salvo", erro: "Erro ao salvar", conflito: "Conflito" };

interface Props {
  pincel: Pincel;
  /** Cor e espessura lembradas por ferramenta (trocar de caneta para marca-texto e voltar não perde a escolha). */
  onPincel: (ferramenta: FerramentaUI) => void;
  onCor: (cor: string) => void;
  onEspessura: (espessura: number) => void;
  dedoDesenha: boolean;
  onDedo: (v: boolean) => void;
  podeDesfazer: boolean;
  podeRefazer: boolean;
  onDesfazer: () => void;
  onRefazer: () => void;
  podeLimpar: boolean;
  onLimpar: () => void;
  estado: EstadoGravacao;
  ehMobile: boolean;
}

export function BarraTinta({ pincel, onPincel, onCor, onEspessura, dedoDesenha, onDedo, podeDesfazer, podeRefazer, onDesfazer, onRefazer, podeLimpar, onLimpar, estado, ehMobile }: Props) {
  const tam = ehMobile ? "h-11 w-11" : "h-8 w-8";
  const separador = <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
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
  const desenhando = pincel.ferramenta !== "borracha";
  const cores = pincel.ferramenta === "marca-texto" ? CORES_MARCA : CORES_CANETA;
  const espessuras = pincel.ferramenta === "marca-texto" ? ESPESSURAS["marca-texto"] : ESPESSURAS.caneta;
  const classeMenu = `${ehMobile ? "h-11" : "h-8"} flex items-center gap-1.5 rounded-lg pl-2 pr-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 disabled:opacity-40`;

  return (
    <div className="ecos-fade-in flex min-w-0 flex-wrap items-center gap-0.5" role="group" aria-label="Ferramentas de escrita">
      {ferramenta("caneta", PenTool, "Caneta")}
      {ferramenta("marca-texto", Highlighter, "Marca-texto")}
      {ferramenta("borracha", Eraser, "Borracha (apaga o traço inteiro)")}
      {separador}
      {desenhando && <>
        <MenuSuspenso ariaLabel="Cor" valor={pincel.cor} onChange={onCor} opcoes={cores} larguraMenu="min-w-[10rem]" classeGatilho={classeMenu}
          gatilho={({ aberto, atual }) => <><span aria-hidden className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: atual?.cor }} /><ChevronDown size={14} className={`text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} />
        <MenuSuspenso ariaLabel="Espessura" valor={String(pincel.espessura)} onChange={(v) => onEspessura(Number(v))} opcoes={espessuras} larguraMenu="min-w-[8rem]" classeGatilho={classeMenu}
          gatilho={({ aberto, atual }) => <><span>{atual?.rotulo ?? "Espessura"}</span><ChevronDown size={14} className={`text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} />
        {separador}
      </>}
      {acao(Undo2, "Desfazer (Ctrl+Z)", onDesfazer, !podeDesfazer)}
      {acao(Redo2, "Refazer (Ctrl+Y)", onRefazer, !podeRefazer)}
      {separador}
      <button type="button" aria-pressed={dedoDesenha} onClick={() => onDedo(!dedoDesenha)} aria-label="Desenhar com o dedo" title={dedoDesenha ? "Dedo desenha (toque para o dedo rolar)" : "Dedo rola a Nota (toque para desenhar com o dedo)"}
        className={`flex ${tam} shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${dedoDesenha ? "bg-steel-500/25 text-text-primary" : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"}`}>
        <Hand size={17} strokeWidth={1.75} />
      </button>
      {acao(Trash2, "Limpar anotações", onLimpar, !podeLimpar, true)}
      {/* Espaço fixo: o texto do estado muda ("Salvando…", "Alterações pendentes") sem mudar a largura da barra nem quebrar linha. */}
      <span aria-live="polite" title={ROTULO_ESTADO[estado]} className={`ml-1 inline-block w-[8.5rem] shrink-0 truncate whitespace-nowrap text-xs ${estado === "erro" || estado === "conflito" ? "text-error" : "text-text-muted"}`}>{ROTULO_ESTADO[estado]}</span>
    </div>
  );
}
