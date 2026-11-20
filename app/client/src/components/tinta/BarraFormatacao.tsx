/**
 * Barra do Modo texto no celular: a mesma paleta flutuante do Modo de escrita (arrasta, encaixa, recolhe, gira),
 * com as ferramentas de formatação no lugar das de caneta. Só muda o conteúdo; o corpo da paleta é `PaletaFlutuante`.
 */
import { ChevronDown, Ellipsis, Heading1, Heading2, Heading3, Type, type LucideIcon } from "lucide-react";
import { MenuSuspenso } from "@/components/common/MenuSuspenso";

export interface ComandoFormatacao { valor: string; rotulo: string; atalho?: string; icone: LucideIcon; executar: () => void }

interface Props {
  /** `p`, `h1`, `h2` ou `h3`: o estilo da linha onde está o cursor. */
  estilo: string;
  onEstilo: (valor: string) => void;
  /** Botões à vista, em grupos separados por um traço. */
  grupos: ComandoFormatacao[][];
  /** O que não cabe à vista vai para o menu "⋯". */
  extras: ComandoFormatacao[];
  ehMobile: boolean;
  vertical?: boolean;
  alinhar?: "esq" | "dir";
}

const ESTILOS = [{ valor: "p", rotulo: "Normal", icone: Type }, { valor: "h1", rotulo: "Título 1", icone: Heading1 }, { valor: "h2", rotulo: "Título 2", icone: Heading2 }, { valor: "h3", rotulo: "Título 3", icone: Heading3 }];

export function BarraFormatacao({ estilo, onEstilo, grupos, extras, ehMobile, vertical = false, alinhar = "esq" }: Props) {
  const tam = ehMobile ? "h-10 w-10" : "h-8 w-8";
  const separador = (k: string) => <span key={k} aria-hidden className={vertical ? "my-1 h-px w-5 shrink-0 bg-border" : "mx-1 h-5 w-px shrink-0 bg-border"} />;
  const atual = ESTILOS.find((e) => e.valor === estilo) ?? ESTILOS[0]!;
  const AtualIcone = atual.icone;
  const classeGatilho = `${ehMobile ? "h-10" : "h-8"} flex items-center gap-1.5 rounded-lg ${vertical ? "w-full justify-center px-2" : "pl-2 pr-1.5"} text-sm text-text-secondary transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400`;
  return (
    <div className={`ecos-fade-in flex min-w-0 items-center gap-0.5 ${vertical ? "flex-col" : "flex-nowrap overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"}`} role="group" aria-label="Formatação do texto">
      <MenuSuspenso ariaLabel="Estilo do texto" valor={estilo} onChange={onEstilo} larguraMenu="min-w-[9rem]" fixo alinhar={alinhar === "dir" ? "dir" : "esq"} opcoes={ESTILOS}
        classeGatilho={classeGatilho}
        gatilho={({ aberto }) => vertical
          ? <AtualIcone size={17} strokeWidth={1.75} aria-hidden />
          : <><span>{atual.rotulo}</span><ChevronDown size={14} className={`text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} aria-hidden /></>} />
      {grupos.map((grupo, i) => (
        <div key={i} className={`flex items-center gap-0.5 ${vertical ? "flex-col" : ""}`}>
          {separador(`s${i}`)}
          {grupo.map(({ valor, rotulo, atalho, icone: Icone, executar }) => (
            <button key={valor} type="button" aria-label={atalho ? `${rotulo} (${atalho})` : rotulo} title={atalho ? `${rotulo} (${atalho})` : rotulo} onClick={executar}
              className={`flex ${tam} shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400`}>
              <Icone size={17} strokeWidth={1.75} />
            </button>
          ))}
        </div>
      ))}
      {separador("extras")}
      <MenuSuspenso ariaLabel="Mais opções de formatação" opcoes={extras} alinhar={alinhar === "dir" ? "dir" : "esq"} fixo larguraMin={220}
        onChange={(valor) => extras.find((c) => c.valor === valor)?.executar()}
        classeGatilho={`flex ${tam} shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400`}
        gatilho={() => <Ellipsis size={18} aria-hidden />} />
    </div>
  );
}
