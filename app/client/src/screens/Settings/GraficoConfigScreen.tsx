import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Activity, ArrowUpRight, CheckCheck, Eye, Gauge, Magnet, Maximize, MessageSquareText, MousePointer2, Move, Network, Palette, RotateCcw, Ruler, Spline, Tag, Type, Unlink, Wind, Zap } from "lucide-react";

import { Toggle } from "@/components/common/Toggle";
import { Deslizante, MarcaTipo, SeletorCor } from "@/screens/Grafico/controles";
import {
  chaveCorDoTipo,
  corDoTipo,
  LIMITES_GRAFICO as L,
  PADRAO_PREFERENCIAS_GRAFICO,
  ROTULOS_TIPO,
  TIPOS_GRAFICO,
  usePreferenciasGrafico,
  type RotulosGrafico,
  type SecaoGrafico,
} from "@/lib/preferencias-grafico";
import { Cabecalho, Linha, Secao, Segmentado } from "./campos-config";

const MODOS_ROTULO: { id: RotulosGrafico; rotulo: string }[] = [
  { id: "auto", rotulo: "Automático" },
  { id: "sempre", rotulo: "Sempre" },
  { id: "hover", rotulo: "Ao passar o mouse" },
  { id: "nunca", rotulo: "Nunca" },
];

const SECOES: SecaoGrafico[] = ["filtros", "cores", "exibicao", "forcas", "animacao"];

/** Âncora de uma seção: o painel flutuante do Gráfico abre esta tela já rolada até ela (`#id`), com um destaque rápido. */
function Ancora({ id, destacada, children }: { id: SecaoGrafico; destacada: boolean; children: ReactNode }) {
  return <div id={id} className={`mt-6 scroll-mt-4 first:mt-0 ${destacada ? "grafico-secao-destaque" : ""}`}>{children}</div>;
}

export function GraficoConfigScreen() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [prefs, alterar, redefinir] = usePreferenciasGrafico();
  const [destacada, setDestacada] = useState<SecaoGrafico | null>(null);

  useEffect(() => {
    const id = hash.replace(/^#/, "") as SecaoGrafico;
    if (!SECOES.includes(id)) return;
    const alvo = document.getElementById(id);
    if (!alvo) return;
    const rolar = window.setTimeout(() => {
      alvo.scrollIntoView({ behavior: "smooth", block: "start" });
      setDestacada(id);
    }, 60);
    const limpar = window.setTimeout(() => setDestacada(null), 1400);
    return () => { window.clearTimeout(rolar); window.clearTimeout(limpar); };
  }, [hash]);

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Gráfico" />
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <span className="min-w-0 flex-1">Ajustes de como as conexões aparecem. Tudo vale na hora, também para o painel flutuante do Gráfico.</span>
        <button type="button" onClick={() => navigate("/grafico")} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 py-1.5 font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary">
          <Network size={14} aria-hidden /> Abrir o Gráfico
        </button>
      </div>

      <Ancora id="filtros" destacada={destacada === "filtros"}>
        <Secao titulo="Filtros">
          {TIPOS_GRAFICO.map((tipo) => (
            <Linha key={tipo} Icone={tipo === "tag" ? Tag : Eye} titulo={ROTULOS_TIPO[tipo]} descricao={`Mostrar ${ROTULOS_TIPO[tipo].toLowerCase()} no gráfico.`}>
              <Toggle checked={prefs.tipos[tipo]} onChange={(v) => alterar({ tipos: { ...prefs.tipos, [tipo]: v } })} label={`Mostrar ${ROTULOS_TIPO[tipo].toLowerCase()}`} />
            </Linha>
          ))}
          <Linha Icone={Unlink} titulo="Itens sem conexão" descricao="Mostra também o que não tem nenhum link, vínculo ou tag.">
            <Toggle checked={prefs.mostrarSemConexao} onChange={(mostrarSemConexao) => alterar({ mostrarSemConexao })} label="Mostrar itens sem conexão" />
          </Linha>
        </Secao>
      </Ancora>

      <Ancora id="cores" destacada={destacada === "cores"}>
        <Secao titulo="Cores">
          {TIPOS_GRAFICO.map((tipo) => {
            const padrao = PADRAO_PREFERENCIAS_GRAFICO[chaveCorDoTipo(tipo)];
            const cor = corDoTipo(prefs, tipo);
            return (
              <Linha key={tipo} Icone={Palette} titulo={`Cor de ${ROTULOS_TIPO[tipo].toLowerCase()}`} descricao={tipo === "evento" ? "Eventos aparecem como losangos." : tipo === "tag" ? "Tags aparecem como pontos menores." : `Nós e destaque de ${ROTULOS_TIPO[tipo].toLowerCase()}.`}>
                <div className="flex shrink-0 items-center gap-2">
                  {cor.toLowerCase() !== padrao.toLowerCase() && (
                    <button type="button" aria-label={`Restaurar cor de ${ROTULOS_TIPO[tipo].toLowerCase()}`} title="Restaurar cor padrão" onClick={() => alterar({ [chaveCorDoTipo(tipo)]: padrao })} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary">
                      <RotateCcw size={14} />
                    </button>
                  )}
                  <span className="font-mono-value text-xs uppercase text-text-muted">{cor}</span>
                  <SeletorCor tipo={tipo} valor={cor} rotulo={ROTULOS_TIPO[tipo]} onChange={(nova) => alterar({ [chaveCorDoTipo(tipo)]: nova })} tamanho={20} />
                </div>
              </Linha>
            );
          })}
          <div className="flex items-center gap-4 px-4 py-3 text-xs text-text-muted">
            {TIPOS_GRAFICO.map((tipo) => (
              <span key={tipo} className="flex items-center gap-1.5"><MarcaTipo tipo={tipo} cor={corDoTipo(prefs, tipo)} tamanho={10} />{ROTULOS_TIPO[tipo]}</span>
            ))}
          </div>
        </Secao>
      </Ancora>

      <Ancora id="exibicao" destacada={destacada === "exibicao"}>
        <Secao titulo="Exibição">
          <Linha Icone={MessageSquareText} titulo="Rótulos" descricao="Quando o título aparece ao lado de cada nó. No modo automático, aparecem ao aproximar o zoom e nos itens mais conectados.">
            <Segmentado valor={prefs.rotulos} opcoes={MODOS_ROTULO} onChange={(rotulos) => alterar({ rotulos })} label="Quando mostrar rótulos" />
          </Linha>
          <Linha Icone={Type} titulo="Tamanho do texto" descricao="Tamanho dos rótulos, em pontos da tela (não muda com o zoom).">
            <Deslizante rotulo="Tamanho do texto" valor={prefs.tamanhoTexto} {...L.tamanhoTexto} onChange={(tamanhoTexto) => alterar({ tamanhoTexto })} formatar={(v) => `${Math.round(v)} pt`} />
          </Linha>
          <Linha Icone={Maximize} titulo="Tamanho dos nós" descricao="Escala de todos os nós. Os mais conectados continuam maiores.">
            <Deslizante rotulo="Tamanho dos nós" valor={prefs.tamanhoNos} {...L.tamanhoNos} onChange={(tamanhoNos) => alterar({ tamanhoNos })} formatar={(v) => `${v.toFixed(2)}×`} />
          </Linha>
          <Linha Icone={Ruler} titulo="Espessura das linhas" descricao="Espessura das ligações entre os itens.">
            <Deslizante rotulo="Espessura das linhas" valor={prefs.espessuraLinhas} {...L.espessuraLinhas} onChange={(espessuraLinhas) => alterar({ espessuraLinhas })} formatar={(v) => `${v.toFixed(1)}×`} />
          </Linha>
          <Linha Icone={ArrowUpRight} titulo="Setas nos links" descricao="Mostra a direção dos [[links]]: de quem aponta para quem é apontado.">
            <Toggle checked={prefs.setas} onChange={(setas) => alterar({ setas })} label="Setas nos links" />
          </Linha>
          <Linha Icone={CheckCheck} titulo="Esmaecer tarefas concluídas" descricao="Tarefas concluídas viram círculos vazados e mais claros.">
            <Toggle checked={prefs.esmaecerConcluidas} onChange={(esmaecerConcluidas) => alterar({ esmaecerConcluidas })} label="Esmaecer tarefas concluídas" />
          </Linha>
          <Linha Icone={MousePointer2} titulo="Dica segue o mouse" descricao="A dica com o título e as conexões acompanha o ponteiro. Desligada, fica ao lado do nó.">
            <Toggle checked={prefs.dicaSegueMouse} onChange={(dicaSegueMouse) => alterar({ dicaSegueMouse })} label="Dica segue o mouse" />
          </Linha>
        </Secao>
      </Ancora>

      <Ancora id="forcas" destacada={destacada === "forcas"}>
        <Secao titulo="Forças">
          <Linha Icone={Zap} titulo="Repulsão" descricao="Quanto os nós se afastam uns dos outros. Valores altos espalham o gráfico.">
            <Deslizante rotulo="Repulsão" valor={prefs.repulsao} {...L.repulsao} onChange={(repulsao) => alterar({ repulsao })} formatar={(v) => String(Math.round(v))} />
          </Linha>
          <Linha Icone={Spline} titulo="Distância dos links" descricao="Comprimento ideal de cada ligação.">
            <Deslizante rotulo="Distância dos links" valor={prefs.distancia} {...L.distancia} onChange={(distancia) => alterar({ distancia })} formatar={(v) => String(Math.round(v))} />
          </Linha>
          <Linha Icone={Magnet} titulo="Atração ao centro" descricao="Mantém os grupos soltos perto do meio, em vez de flutuarem para longe.">
            <Deslizante rotulo="Atração ao centro" valor={prefs.gravidade} {...L.gravidade} onChange={(gravidade) => alterar({ gravidade })} formatar={(v) => v.toFixed(3)} />
          </Linha>
        </Secao>
      </Ancora>

      <Ancora id="animacao" destacada={destacada === "animacao"}>
        <Secao titulo="Animação">
          <Linha Icone={Wind} titulo="Movimento contínuo" descricao="Os nós flutuam de leve o tempo todo, como se respirassem. Em Aparência, “Reduzir movimento” desliga isto também.">
            <Toggle checked={prefs.movimentoOcioso} onChange={(movimentoOcioso) => alterar({ movimentoOcioso })} label="Movimento contínuo" />
          </Linha>
          <Linha Icone={Move} titulo="Intensidade do movimento" descricao="O quanto os nós se mexem quando parados.">
            <Deslizante rotulo="Intensidade do movimento" valor={prefs.intensidadeMovimento} {...L.intensidadeMovimento} onChange={(intensidadeMovimento) => alterar({ intensidadeMovimento })} formatar={(v) => `${v.toFixed(2)}×`} />
          </Linha>
          <Linha Icone={Gauge} titulo="Velocidade das animações" descricao="Rapidez de destaques, esmaecimentos, zoom e da dica.">
            <Deslizante rotulo="Velocidade das animações" valor={prefs.velocidadeAnimacao} {...L.velocidadeAnimacao} onChange={(velocidadeAnimacao) => alterar({ velocidadeAnimacao })} formatar={(v) => `${v.toFixed(2)}×`} />
          </Linha>
        </Secao>
      </Ancora>

      <div className="mt-8 flex justify-end">
        <button type="button" onClick={redefinir} className="flex items-center gap-2 rounded-xl border border-border bg-surface-1 px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary">
          <Activity size={15} aria-hidden /> Restaurar padrões do Gráfico
        </button>
      </div>
    </div>
  );
}
