import { useState, type ReactNode } from "react";
import { ChevronDown, Maximize2, RotateCcw, Search, SlidersHorizontal, X, Settings2 } from "lucide-react";

import { Toggle } from "@/components/common/Toggle";
import {
  chaveCorDoTipo,
  corDoTipo,
  LIMITES_GRAFICO as L,
  ROTULOS_TIPO,
  TIPOS_GRAFICO,
  type PreferenciasGrafico,
  type RotulosGrafico,
  type SecaoGrafico,
  type TipoGrafico,
} from "@/lib/preferencias-grafico";
import { Deslizante, SeletorCor } from "./controles";

const CHAVE_PAINEL = "ecos:grafico:painel:v1";

interface EstadoPainel { aberto: boolean; secoes: Record<SecaoGrafico, boolean> }
const PADRAO_PAINEL: EstadoPainel = { aberto: true, secoes: { filtros: true, cores: false, exibicao: true, forcas: false, animacao: false, minigrafo: false } };

function lerEstado(): EstadoPainel {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_PAINEL) ?? "null");
    if (bruto && typeof bruto === "object") return { aberto: bruto.aberto !== false, secoes: { ...PADRAO_PAINEL.secoes, ...(bruto.secoes ?? {}) } };
  } catch { /* sem armazenamento: usa o padrão */ }
  return PADRAO_PAINEL;
}

interface Props {
  prefs: PreferenciasGrafico;
  alterar: (patch: Partial<PreferenciasGrafico>) => void;
  redefinir: () => void;
  contagens: Record<TipoGrafico, number>;
  busca: string;
  onBusca: (texto: string) => void;
  onAjustar: () => void;
  onAbrirConfig: (secao: SecaoGrafico) => void;
}

const ROTULOS: { id: RotulosGrafico; rotulo: string }[] = [
  { id: "auto", rotulo: "Auto" },
  { id: "sempre", rotulo: "Sempre" },
  { id: "hover", rotulo: "Hover" },
  { id: "nunca", rotulo: "Nunca" },
];

/** Painel flutuante ao lado do gráfico (Obsidian/Linear): busca, filtros, cores e ajustes rápidos; cada bloco leva à tela de Configurações. */
export function PainelGrafico({ prefs, alterar, redefinir, contagens, busca, onBusca, onAjustar, onAbrirConfig }: Props) {
  const [estado, setEstado] = useState(lerEstado);
  const gravar = (proximo: EstadoPainel) => {
    setEstado(proximo);
    try { localStorage.setItem(CHAVE_PAINEL, JSON.stringify(proximo)); } catch { /* só vale nesta sessão */ }
  };
  const alternar = (secao: SecaoGrafico) => gravar({ ...estado, secoes: { ...estado.secoes, [secao]: !estado.secoes[secao] } });

  return (
    <>
      <button
        type="button"
        aria-label="Abrir painel do gráfico"
        onClick={() => gravar({ ...estado, aberto: true })}
        className={`absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface-1/90 text-text-secondary shadow-md backdrop-blur-md transition-[opacity,transform] duration-200 ease-out hover:text-text-primary ${estado.aberto ? "pointer-events-none scale-75 opacity-0" : "scale-100 opacity-100"}`}
      >
        <SlidersHorizontal size={16} />
      </button>

      <aside
        aria-label="Painel do gráfico"
        aria-hidden={!estado.aberto}
        className={`absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-72 origin-top-right flex-col overflow-hidden rounded-2xl border border-border bg-surface-1/85 shadow-xl backdrop-blur-xl transition-[opacity,transform] duration-200 ease-out ${estado.aberto ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"}`}
      >
        <header className="flex items-center gap-1 border-b border-border/60 px-3 py-2">
          <span className="flex-1 text-sm font-medium text-text-primary">Gráfico</span>
          <BotaoIcone rotulo="Enquadrar tudo" onClick={onAjustar}><Maximize2 size={14} /></BotaoIcone>
          <BotaoIcone rotulo="Restaurar padrões" onClick={redefinir}><RotateCcw size={14} /></BotaoIcone>
          <BotaoIcone rotulo="Recolher painel" onClick={() => gravar({ ...estado, aberto: false })}><X size={15} /></BotaoIcone>
        </header>

        <div className="overflow-y-auto overscroll-contain">
          <div className="px-3 pt-3">
            <label className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/70 px-2.5 py-1.5 transition-colors focus-within:border-steel-400">
              <Search size={14} className="shrink-0 text-text-muted" aria-hidden />
              <input
                type="text"
                value={busca}
                onChange={(e) => onBusca(e.target.value)}
                placeholder="Buscar no gráfico…"
                aria-label="Buscar no gráfico"
                className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
              />
              {busca && <button type="button" aria-label="Limpar busca" onClick={() => onBusca("")} className="text-text-muted hover:text-text-primary"><X size={13} /></button>}
            </label>
          </div>

          <Bloco id="filtros" titulo="Filtros" aberto={estado.secoes.filtros} onAlternar={alternar} onAbrirConfig={onAbrirConfig}>
            {TIPOS_GRAFICO.map((tipo) => (
              <div key={tipo} className="flex items-center gap-1 rounded-lg px-1 py-0.5 transition-colors hover:bg-surface-2/70">
                <SeletorCor tipo={tipo} valor={corDoTipo(prefs, tipo)} rotulo={ROTULOS_TIPO[tipo]} onChange={(cor) => alterar({ [chaveCorDoTipo(tipo)]: cor })} />
                <button type="button" onClick={() => alterar({ tipos: { ...prefs.tipos, [tipo]: !prefs.tipos[tipo] } })} className={`min-w-0 flex-1 truncate text-left text-xs transition-colors ${prefs.tipos[tipo] ? "text-text-primary" : "text-text-muted"}`}>
                  {ROTULOS_TIPO[tipo]}
                </button>
                <span className="font-mono-value text-[11px] tabular-nums text-text-muted">{contagens[tipo]}</span>
                <span className="text-[10px]"><Toggle checked={prefs.tipos[tipo]} onChange={(v) => alterar({ tipos: { ...prefs.tipos, [tipo]: v } })} label={`Mostrar ${ROTULOS_TIPO[tipo].toLowerCase()}`} /></span>
              </div>
            ))}
            <Linha rotulo="Itens sem conexão">
              <span className="text-[10px]"><Toggle checked={prefs.mostrarSemConexao} onChange={(mostrarSemConexao) => alterar({ mostrarSemConexao })} label="Mostrar itens sem conexão" /></span>
            </Linha>
          </Bloco>

          <Bloco id="exibicao" titulo="Exibição" aberto={estado.secoes.exibicao} onAlternar={alternar} onAbrirConfig={onAbrirConfig}>
            <Linha rotulo="Rótulos">
              <div className="flex rounded-md border border-border bg-surface-2/70 p-0.5" role="group" aria-label="Quando mostrar rótulos">
                {ROTULOS.map(({ id, rotulo }) => (
                  <button key={id} type="button" aria-pressed={prefs.rotulos === id} onClick={() => alterar({ rotulos: id })} className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${prefs.rotulos === id ? "bg-surface-3 text-text-primary" : "text-text-muted hover:text-text-secondary"}`}>{rotulo}</button>
                ))}
              </div>
            </Linha>
            <Linha rotulo="Tamanho dos nós"><Deslizante rotulo="Tamanho dos nós" largura="w-24" valor={prefs.tamanhoNos} {...L.tamanhoNos} onChange={(tamanhoNos) => alterar({ tamanhoNos })} formatar={(v) => `${v.toFixed(1)}×`} /></Linha>
            <Linha rotulo="Espessura das linhas"><Deslizante rotulo="Espessura das linhas" largura="w-24" valor={prefs.espessuraLinhas} {...L.espessuraLinhas} onChange={(espessuraLinhas) => alterar({ espessuraLinhas })} formatar={(v) => `${v.toFixed(1)}×`} /></Linha>
            <Linha rotulo="Setas nos links"><span className="text-[10px]"><Toggle checked={prefs.setas} onChange={(setas) => alterar({ setas })} label="Setas nos links" /></span></Linha>
          </Bloco>

          <Bloco id="forcas" titulo="Forças" aberto={estado.secoes.forcas} onAlternar={alternar} onAbrirConfig={onAbrirConfig}>
            <Linha rotulo="Repulsão"><Deslizante rotulo="Repulsão" largura="w-24" valor={prefs.repulsao} {...L.repulsao} onChange={(repulsao) => alterar({ repulsao })} formatar={(v) => String(Math.round(v))} /></Linha>
            <Linha rotulo="Distância dos links"><Deslizante rotulo="Distância dos links" largura="w-24" valor={prefs.distancia} {...L.distancia} onChange={(distancia) => alterar({ distancia })} formatar={(v) => String(Math.round(v))} /></Linha>
            <Linha rotulo="Atração ao centro"><Deslizante rotulo="Atração ao centro" largura="w-24" valor={prefs.gravidade} {...L.gravidade} onChange={(gravidade) => alterar({ gravidade })} formatar={(v) => v.toFixed(2)} /></Linha>
          </Bloco>

          <Bloco id="animacao" titulo="Animação" aberto={estado.secoes.animacao} onAlternar={alternar} onAbrirConfig={onAbrirConfig}>
            <Linha rotulo="Movimento contínuo"><span className="text-[10px]"><Toggle checked={prefs.movimentoOcioso} onChange={(movimentoOcioso) => alterar({ movimentoOcioso })} label="Movimento contínuo" /></span></Linha>
            <Linha rotulo="Intensidade"><Deslizante rotulo="Intensidade do movimento" largura="w-24" valor={prefs.intensidadeMovimento} {...L.intensidadeMovimento} onChange={(intensidadeMovimento) => alterar({ intensidadeMovimento })} formatar={(v) => `${v.toFixed(1)}×`} /></Linha>
            <Linha rotulo="Velocidade"><Deslizante rotulo="Velocidade das animações" largura="w-24" valor={prefs.velocidadeAnimacao} {...L.velocidadeAnimacao} onChange={(velocidadeAnimacao) => alterar({ velocidadeAnimacao })} formatar={(v) => `${v.toFixed(1)}×`} /></Linha>
          </Bloco>

          <div className="px-3 pb-3 pt-1">
            <button type="button" onClick={() => onAbrirConfig("cores")} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-2/60 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary">
              <Settings2 size={13} aria-hidden /> Todas as configurações do gráfico
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function BotaoIcone({ rotulo, onClick, children }: { rotulo: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={rotulo} title={rotulo} onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary">
      {children}
    </button>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-2 px-1">
      <span className="min-w-0 truncate text-xs text-text-secondary">{rotulo}</span>
      {children}
    </div>
  );
}

interface BlocoProps {
  id: SecaoGrafico;
  titulo: string;
  aberto: boolean;
  onAlternar: (id: SecaoGrafico) => void;
  onAbrirConfig: (id: SecaoGrafico) => void;
  children: ReactNode;
}

/** Bloco recolhível; a altura anima com a técnica de linhas de grade (0fr → 1fr), sem medir nada. */
function Bloco({ id, titulo, aberto, onAlternar, onAbrirConfig, children }: BlocoProps) {
  return (
    <section className="mt-1 px-2 pt-1">
      <div className="flex items-center rounded-lg transition-colors hover:bg-surface-2/60">
        <button type="button" aria-expanded={aberto} onClick={() => onAlternar(id)} className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1.5 text-left">
          <ChevronDown size={13} className={`shrink-0 text-text-muted transition-transform duration-200 ${aberto ? "" : "-rotate-90"}`} aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{titulo}</span>
        </button>
        <button type="button" aria-label={`Abrir ${titulo.toLowerCase()} nas configurações`} title="Abrir nas configurações" onClick={() => onAbrirConfig(id)} className="mr-1 flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary">
          <Settings2 size={12} />
        </button>
      </div>
      <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${aberto ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-0.5 px-1 pb-2 pt-0.5">{children}</div>
        </div>
      </div>
    </section>
  );
}

