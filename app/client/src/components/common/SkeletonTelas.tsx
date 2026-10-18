import { Skeleton, SkeletonRegiao, SkeletonTexto } from "@/components/common/Skeleton";
import { modoEfetivo, type ModoVisualizacao } from "@/components/common/ViewModeToggle";
import { useIsDesktop } from "@/lib/use-viewport";

/**
 * Skeletons por tela: cada um repete a ESTRUTURA do conteúdo real (mesmos blocos, mesma ordem, alturas aproximadas)
 * para não haver salto de layout quando o dado chega. Os blocos principais levam `data-bloco="nome"`; os testes de
 * forma (SkeletonTelas.test.tsx) comparam essa lista com a estrutura da tela real.
 */

type Base = { rotulo?: string; atrasoMs?: number; className?: string };

const CARTAO = "rounded-card border-l-4 border-border bg-surface-1 p-4";

/* ───────── Listas de notas e tarefas (Feed, Notas, Tarefas) ───────── */

function CartaoTarefa() {
  return (
    <div data-bloco="cartao-tarefa" className={`flex flex-col gap-2 ${CARTAO}`}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <Skeleton variante="texto" className="w-24" />
        <Skeleton variante="linha" className="h-5 w-24 rounded-md" />
      </div>
      <div className="flex items-start gap-2.5">
        <Skeleton variante="circulo" className="h-[18px] w-[18px]" />
        <Skeleton variante="linha" className="w-3/5" />
      </div>
      <div className="flex flex-col gap-2 pl-7"><Skeleton variante="texto" className="w-5/6" /><Skeleton variante="texto" className="w-2/3" /></div>
      <div className="mt-1 flex items-center gap-3">
        <Skeleton variante="circulo" className="h-[18px] w-[18px]" />
        <Skeleton variante="texto" className="w-40" />
        <Skeleton variante="texto" className="w-14" />
      </div>
    </div>
  );
}

function CartaoNota() {
  return (
    <div data-bloco="cartao-nota" className={`flex flex-col gap-2 ${CARTAO}`}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <Skeleton variante="texto" className="w-24" />
        <Skeleton variante="linha" className="h-5 w-14 rounded-md" />
      </div>
      <Skeleton variante="linha" className="w-2/3" />
      <div className="flex flex-col gap-2"><Skeleton variante="texto" className="w-full" /><Skeleton variante="texto" className="w-5/6" /><Skeleton variante="texto" className="w-1/2" /></div>
      <div className="mt-1 flex items-center gap-3">
        <Skeleton variante="circulo" className="h-[18px] w-[18px]" />
        <Skeleton variante="texto" className="w-40" />
      </div>
    </div>
  );
}

function LinhaCompacta({ tipo }: { tipo: "nota" | "tarefa" }) {
  return (
    <div data-bloco={`linha-${tipo}`} className="flex w-full items-center gap-3 rounded-2xl bg-surface-1 px-3.5 py-3">
      <Skeleton variante="circulo" className="h-4 w-4" />
      {tipo === "tarefa" && <Skeleton variante="circulo" className="h-1.5 w-1.5" />}
      <div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton variante="linha" className="w-1/2" /><Skeleton variante="texto" className="w-1/3" /></div>
      {tipo === "tarefa" && <Skeleton variante="texto" className="w-10" />}
    </div>
  );
}

/** Barra de pesquisa e filtros (BarraFiltros) das listas que a exibem. */
function BarraFiltros() {
  return (
    <div data-bloco="barra-filtros" className="mb-3 flex flex-wrap items-center gap-2">
      <Skeleton variante="bloco" className="h-10 min-w-[200px] flex-1 rounded-xl" />
      <Skeleton variante="bloco" className="h-10 w-24 rounded-xl" />
      <Skeleton variante="bloco" className="h-10 w-24 rounded-xl" />
    </div>
  );
}

const COLUNAS_TAREFAS = [340, 108, 104, 132, 92, 150, 210, 150];
const COLUNAS_NOTAS = [340, 150, 210, 150, 112];

function Tabela({ larguras, linhas }: { larguras: number[]; linhas: number }) {
  const modelo = larguras.map((l, i) => (i === 0 ? `minmax(${l}px,1fr)` : `${l}px`)).join(" ");
  const total = larguras.reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-xl border border-border bg-surface-1">
        <div style={{ minWidth: total }}>
          <div data-bloco="tabela-cabecalho" className="grid h-9 items-center border-b border-border bg-surface-2" style={{ gridTemplateColumns: modelo }}>
            {larguras.map((_, i) => <div key={i} className="px-3"><Skeleton variante="texto" className="w-1/2" /></div>)}
          </div>
          {Array.from({ length: linhas }, (_, r) => (
            <div key={r} data-bloco="tabela-linha" className="grid min-h-[40px] items-center border-b border-border last:border-b-0" style={{ gridTemplateColumns: modelo }}>
              {larguras.map((_, c) => (
                <div key={c} className="flex items-center gap-2 px-3 py-1.5">
                  {c === 0 && <Skeleton variante="circulo" className="h-[15px] w-[15px]" />}
                  <Skeleton variante="texto" className={c === 0 ? "w-3/4" : c === 1 || c === 2 ? "h-5 w-16 rounded-md" : "w-3/5"} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <Skeleton variante="texto" className="ml-1 w-14" />
    </div>
  );
}

/**
 * Corpo de uma lista de itens, na visão que a tela real mostraria (mesma regra `modoEfetivo` de ListaDeItens).
 * Tabela no desktop das telas de tarefas; lista compacta; cartões nos demais casos (grade/kanban/matriz/agrupada
 * caem em cartões: a estrutura delas depende dos dados).
 */
export function SkeletonItens({ modo = "cards", tipo = "misto", semFeedNoDesktop = false, filtros = true, itens = 4, rotulo, atrasoMs, className }:
  Base & { modo?: ModoVisualizacao; tipo?: "nota" | "tarefa" | "misto"; semFeedNoDesktop?: boolean; filtros?: boolean; itens?: number }) {
  const desktop = useIsDesktop();
  const efetivo = modoEfetivo(modo, desktop, semFeedNoDesktop);
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      {filtros && <BarraFiltros />}
      {efetivo === "tabela" ? <Tabela larguras={tipo === "nota" ? COLUNAS_NOTAS : COLUNAS_TAREFAS} linhas={itens + 2} />
        : efetivo === "lista" ? <div className="flex flex-col gap-2">{Array.from({ length: itens + 2 }, (_, i) => <LinhaCompacta key={i} tipo={tipo === "nota" ? "nota" : "tarefa"} />)}</div>
          : <Cartoes tipo={tipo} itens={itens} />}
    </SkeletonRegiao>
  );
}

/** Coluna de cartões (max 780px) agrupada por dia, como a visão "cards" real. */
function Cartoes({ tipo, itens }: { tipo: "nota" | "tarefa" | "misto"; itens: number }) {
  return (
    <div className="mx-auto flex w-full max-w-[780px] flex-col gap-3">
      <Skeleton data-bloco="grupo-data" variante="texto" className="mt-3 w-20" />
      {Array.from({ length: itens }, (_, i) => (tipo === "nota" || (tipo === "misto" && i % 2 === 1) ? <CartaoNota key={i} /> : <CartaoTarefa key={i} />))}
    </div>
  );
}

/** Feed: cartões de nota e tarefa agrupados por dia, sem barra de filtros (não depende do viewport). */
export function SkeletonFeed({ itens = 4, rotulo, atrasoMs, className }: Base & { itens?: number }) {
  return <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}><Cartoes tipo="misto" itens={itens} /></SkeletonRegiao>;
}

/* ───────── Detalhes (tarefa, nota) ───────── */

function Campo({ rotulo = "w-28", altura = "h-10" }: { rotulo?: string; altura?: string }) {
  return <div className="flex flex-col gap-2"><Skeleton variante="texto" className={rotulo} /><Skeleton variante="bloco" className={`${altura} w-full rounded-lg`} /></div>;
}

function Editor({ linhas }: { linhas: number }) {
  return (
    <div data-bloco="editor" className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4">
      <div className="flex gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} variante="bloco" className="h-8 w-8 rounded-lg" />)}</div>
      <SkeletonTexto linhas={linhas} />
    </div>
  );
}

/**
 * Detalhe da tarefa (TaskComposer): título + ações, prioridade, anexos, descrição | painel lateral (Planejamento, Tempo,
 * Organização, Subtarefas) e rodapé. No celular o painel fica atrás de "Mais detalhes" e há a linha de status no topo.
 */
export function SkeletonTarefaDetalhe({ desktop, rotulo, atrasoMs, className }: Base & { desktop: boolean }) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div className="flex min-w-0 flex-col gap-6">
        {!desktop && (
          <div data-bloco="cabecalho-status" className="flex items-center gap-3">
            <Skeleton variante="circulo" className="h-[25px] w-[25px]" />
            <Skeleton variante="linha" className="h-7 w-1/2" />
          </div>
        )}
        <div data-bloco="titulo" className="flex min-w-0 items-center gap-3">
          <Skeleton variante="bloco" className="h-[54px] flex-1 rounded-xl" />
          {desktop && (
            <div className="flex shrink-0 items-center gap-2">
              <Skeleton data-bloco="prioridade" variante="bloco" className="h-[52px] w-40 rounded-xl" />
              <Skeleton variante="bloco" className="h-[52px] w-[52px] rounded-xl" />
              <Skeleton variante="bloco" className="h-[52px] w-32 rounded-xl" />
              <Skeleton variante="bloco" className="h-[52px] w-[52px] rounded-xl" />
            </div>
          )}
        </div>
        {!desktop && <Skeleton data-bloco="prioridade" variante="bloco" className="h-12 w-full rounded-xl" />}
        <Skeleton data-bloco="anexos" variante="bloco" className="h-12 w-full rounded-xl" />
        <div className={desktop ? "grid min-w-0 grid-cols-[minmax(0,1fr)_320px] gap-7" : "grid min-w-0 gap-7"}>
          <div className="flex min-w-0 flex-col gap-6">
            <div data-bloco="descricao"><Editor linhas={8} /></div>
            {!desktop && (
              <div data-bloco="mais-detalhes" className="flex min-h-12 flex-col gap-2 border-t border-border pt-5">
                <Skeleton variante="linha" className="w-40" />
                <Skeleton variante="texto" className="w-3/4" />
              </div>
            )}
          </div>
          {desktop && (
            <aside className="flex min-w-0 flex-col border-l border-border pl-4">
              <section data-bloco="planejamento" className="flex flex-col gap-4">
                <Skeleton variante="linha" className="w-28" />
                <div className="flex flex-wrap gap-4"><div className="min-w-[190px] flex-1"><Campo /></div><div className="w-32"><Campo rotulo="w-24" /></div></div>
              </section>
              <section data-bloco="tempo" className="mt-6 flex flex-col gap-3 border-t border-border pt-6">
                <div className="flex items-center justify-between gap-3"><div className="flex flex-col gap-2"><Skeleton variante="linha" className="w-16" /><Skeleton variante="texto" className="w-40" /></div><div className="flex gap-2"><Skeleton variante="bloco" className="h-10 w-28 rounded-lg" /><Skeleton variante="bloco" className="h-10 w-32 rounded-lg" /></div></div>
              </section>
              <section data-bloco="organizacao" className="mt-6 flex flex-col gap-4 border-t border-border pt-6">
                <Skeleton variante="linha" className="w-28" />
                <Campo altura="h-11" />
                <Campo altura="h-11" />
                <div className="flex flex-col gap-2"><Skeleton variante="texto" className="w-10" /><div className="flex gap-2"><Skeleton variante="bloco" className="h-10 flex-1 rounded-lg" /><Skeleton variante="bloco" className="h-10 w-12 rounded-lg" /></div></div>
                <div className="flex gap-2"><Skeleton variante="bloco" className="h-9 w-16 rounded-lg" /><Skeleton variante="bloco" className="h-9 w-20 rounded-lg" /></div>
              </section>
              <section data-bloco="subtarefas" className="mt-6 border-t border-border pt-6">
                <div className="mb-3 flex items-center justify-between gap-2"><Skeleton variante="linha" className="w-24" /><Skeleton variante="texto" className="w-16" /></div>
                <div className="mb-3 flex flex-col gap-1">{Array.from({ length: 2 }, (_, i) => <div key={i} className="flex min-h-11 items-center gap-3 border-b border-border"><Skeleton variante="texto" className="h-4 w-4" /><Skeleton variante="texto" className="w-2/3" /></div>)}</div>
                <div className="flex gap-2"><Skeleton variante="bloco" className="h-10 flex-1 rounded-lg" /><Skeleton variante="bloco" className="h-10 w-12 rounded-lg" /></div>
              </section>
            </aside>
          )}
        </div>
        <div data-bloco="rodape" className="border-t border-border pt-4"><Skeleton variante="texto" className="w-2/3" /></div>
      </div>
    </SkeletonRegiao>
  );
}

/** Detalhe da nota (editor): título + ações, pasta/tags, equipe, anexos, editor e rodapé de datas. */
export function SkeletonNotaDetalhe({ rotulo, atrasoMs, className }: Base) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div className="flex min-w-0 flex-col gap-4">
        <div data-bloco="titulo" className="flex min-w-0 items-center gap-3">
          <Skeleton variante="bloco" className="h-[54px] flex-1 rounded-xl" />
          <Skeleton variante="bloco" className="h-[52px] w-[52px] rounded-xl" />
          <Skeleton variante="bloco" className="h-[52px] w-[52px] rounded-xl" />
        </div>
        <div data-bloco="organizacao" className="flex flex-wrap gap-3"><Skeleton variante="bloco" className="h-11 w-48 rounded-lg" /><Skeleton variante="bloco" className="h-11 w-64 rounded-lg" /></div>
        <Skeleton data-bloco="equipe" variante="bloco" className="h-11 w-56 rounded-lg" />
        <Skeleton data-bloco="anexos" variante="bloco" className="h-12 w-full rounded-xl" />
        <Editor linhas={12} />
        <div data-bloco="rodape" className="flex items-center justify-between gap-3"><Skeleton variante="texto" className="w-64" /><Skeleton variante="texto" className="w-16" /></div>
      </div>
    </SkeletonRegiao>
  );
}

/* ───────── Listas simples por tela ───────── */

function CabecalhoGrupo({ largura = "w-20" }: { largura?: string }) {
  return <Skeleton data-bloco="grupo" variante="texto" className={`mb-2 ${largura}`} />;
}

/** Notificações: grupos por data, cada aviso com título, texto, tempo e (às vezes) o ponto de não lida. */
export function SkeletonNotificacoes({ grupos = 2, itens = 2, rotulo, atrasoMs, className }: Base & { grupos?: number; itens?: number }) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      {Array.from({ length: grupos }, (_, g) => (
        <div key={g} className="mb-5">
          <CabecalhoGrupo />
          <div className="flex flex-col gap-1">
            {Array.from({ length: itens }, (_, i) => (
              <div key={i} data-bloco="aviso" className="flex w-full items-start gap-3 rounded-2xl px-2 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton variante="linha" className="w-1/2" /><Skeleton variante="texto" className="w-5/6" /><Skeleton variante="texto" className="w-16" /></div>
                <Skeleton variante="circulo" className="mt-1.5 h-2 w-2" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonRegiao>
  );
}

/** Lixeira: cartões com ícone, nome, tipo/data e botão Restaurar. */
export function SkeletonLixeira({ itens = 4, rotulo, atrasoMs, className }: Base & { itens?: number }) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div className="flex flex-col gap-3">
        {Array.from({ length: itens }, (_, i) => (
          <div key={i} data-bloco="item-lixeira" className="flex items-center gap-3 rounded-2xl border border-border bg-surface-1 p-4">
            <Skeleton variante="bloco" className="h-[22px] w-[22px] rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton variante="linha" className="w-1/2" /><Skeleton variante="texto" className="w-2/5" /></div>
            <Skeleton variante="bloco" className="h-8 w-24 rounded-xl" />
          </div>
        ))}
      </div>
    </SkeletonRegiao>
  );
}

/** Mídia: grade de 2 colunas; miniatura de 128px, nome, tamanho e linha de ações. */
export function SkeletonMidia({ itens = 6, rotulo, atrasoMs, className }: Base & { itens?: number }) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: itens }, (_, i) => (
          <div key={i} data-bloco="item-midia" className="overflow-hidden rounded-2xl border border-border bg-surface-1">
            <Skeleton variante="bloco" className="h-32 w-full rounded-none" />
            <div className="flex flex-col gap-2 p-3">
              <Skeleton variante="linha" className="w-3/4" />
              <Skeleton variante="texto" className="w-1/4" />
              <div className="mt-1 flex items-center justify-between"><Skeleton variante="texto" className="w-24" /><Skeleton variante="bloco" className="h-6 w-6 rounded-lg" /></div>
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegiao>
  );
}

/** Linhas de equipe dentro do cartão "Suas equipes" (avatar 38, nome, cargo, seta). */
export function SkeletonEquipes({ itens = 3, rotulo, atrasoMs, className }: Base & { itens?: number }) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      {Array.from({ length: itens }, (_, i) => (
        <div key={i} data-bloco="linha-equipe" className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0">
          <Skeleton variante="circulo" className="h-[38px] w-[38px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton variante="linha" className="w-1/3" /><Skeleton variante="texto" className="w-16" /></div>
          <Skeleton variante="texto" className="w-4" />
        </div>
      ))}
    </SkeletonRegiao>
  );
}

/** Perfil da equipe: avatar 72 + nome, tipo, estatísticas (2), botões e lista de membros. */
export function SkeletonEquipePerfil({ membros = 3, rotulo, atrasoMs, className }: Base & { membros?: number }) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div data-bloco="cabecalho" className="mb-5 flex flex-col items-center gap-3"><Skeleton variante="circulo" className="h-[72px] w-[72px]" /><Skeleton variante="linha" className="h-7 w-40" /></div>
      <div data-bloco="tipo" className="mb-5 flex justify-center"><Skeleton variante="linha" className="h-6 w-32 rounded-pill" /></div>
      <div data-bloco="estatisticas" className="mb-5 grid grid-cols-2 divide-x divide-border rounded-2xl bg-surface-1 py-3">
        {Array.from({ length: 2 }, (_, i) => <div key={i} className="flex flex-col items-center gap-2"><Skeleton variante="linha" className="h-6 w-10" /><Skeleton variante="texto" className="w-14" /></div>)}
      </div>
      <div data-bloco="acoes" className="mb-6 flex gap-3"><Skeleton variante="bloco" className="h-11 flex-1 rounded-2xl" /><Skeleton variante="bloco" className="h-11 flex-1 rounded-2xl" /></div>
      <CabecalhoGrupo largura="w-20" />
      <div className="flex flex-col gap-1">
        {Array.from({ length: membros }, (_, i) => (
          <div key={i} data-bloco="membro" className="flex items-center gap-3 rounded-2xl px-1 py-2.5">
            <Skeleton variante="circulo" className="h-9 w-9" />
            <div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton variante="linha" className="w-1/3" /><Skeleton variante="texto" className="w-14" /></div>
          </div>
        ))}
      </div>
    </SkeletonRegiao>
  );
}

function MetricasCorpo() {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-surface-1">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} data-bloco="metrica" className="flex min-w-0 items-center gap-3 border-b border-r border-border p-4">
          <Skeleton variante="circulo" className="h-5 w-5" />
          <div className="flex flex-1 flex-col gap-2"><Skeleton variante="texto" className="w-1/2" /><Skeleton variante="linha" className="w-2/3" /></div>
        </div>
      ))}
      <div data-bloco="metrica-largura" className="col-span-2 flex items-center gap-3 px-4 py-3">
        <Skeleton variante="circulo" className="h-[19px] w-[19px]" />
        <div className="flex flex-1 flex-col gap-2"><Skeleton variante="texto" className="w-1/2" /><Skeleton variante="linha" className="w-1/3" /></div>
      </div>
    </div>
  );
}

/** Bloco "Seu espaço" do Perfil, dentro da tela já montada. */
export function SkeletonMetricasPerfil({ rotulo, atrasoMs, className }: Base) {
  return <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}><MetricasCorpo /></SkeletonRegiao>;
}

/** Perfil inteiro: voltar, avatar 72 + nome, cartão Editar perfil, título "Seu espaço" e métricas. */
export function SkeletonPerfilTela({ rotulo, atrasoMs, className = "" }: Base) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={`px-4 pt-[calc(env(safe-area-inset-top)+12px)] ${className}`}>
      <Skeleton data-bloco="voltar" variante="linha" className="mb-4 w-20" />
      <div data-bloco="cabecalho" className="mb-6 flex flex-col items-center gap-3"><Skeleton variante="circulo" className="h-[72px] w-[72px]" /><Skeleton variante="linha" className="h-7 w-40" /><Skeleton variante="texto" className="w-56" /></div>
      <div data-bloco="editar-perfil" className="mb-6 flex items-center gap-3 rounded-2xl border border-border bg-surface-1 p-4"><Skeleton variante="circulo" className="h-[22px] w-[22px]" /><div className="flex flex-1 flex-col gap-2"><Skeleton variante="linha" className="w-1/3" /><Skeleton variante="texto" className="w-1/2" /></div></div>
      <Skeleton data-bloco="titulo-espaco" variante="texto" className="mb-2 w-20" />
      <MetricasCorpo />
    </SkeletonRegiao>
  );
}

/** Busca: grupos (Notas, Tarefas...) com resultados de duas linhas. */
export function SkeletonBusca({ rotulo, atrasoMs, className }: Base) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div className="flex flex-col gap-6">
        {[3, 2].map((n, g) => (
          <div key={g}>
            <CabecalhoGrupo />
            <div className="flex flex-col gap-1">
              {Array.from({ length: n }, (_, i) => <div key={i} data-bloco="resultado" className="flex w-full flex-col gap-2 rounded-xl bg-surface-1 px-3.5 py-3"><Skeleton variante="linha" className="w-1/2" /><Skeleton variante="texto" className="w-4/5" /></div>)}
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegiao>
  );
}

/** Hoje: grupos (título + contagem) com linhas de horário, ícone e título. */
export function SkeletonHoje({ rotulo, atrasoMs, className }: Base) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div className="space-y-5">
        {[2, 3].map((n, g) => (
          <section key={g}>
            <CabecalhoGrupo largura="w-32" />
            <div className="flex flex-col gap-2">
              {Array.from({ length: n }, (_, i) => (
                <div key={i} data-bloco="item-dia" className="flex items-center gap-3 rounded-xl border border-l-4 border-border bg-surface-1 px-3 py-2">
                  <Skeleton variante="texto" className="w-24" />
                  <Skeleton variante="linha" className="w-1/2" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </SkeletonRegiao>
  );
}

/** Agenda, lista do dia: cartões de tarefa com borda lateral, ícone, título e horário/duração. */
export function SkeletonAgendaLista({ itens = 3, rotulo, atrasoMs, className }: Base & { itens?: number }) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: itens }, (_, i) => (
          <div key={i} data-bloco="cartao-agenda" className="flex items-center gap-3 rounded-2xl border-l-4 border-border bg-surface-1 p-3.5">
            <Skeleton variante="circulo" className="h-[18px] w-[18px]" />
            <div className="flex min-w-0 flex-1 flex-col gap-2"><Skeleton variante="linha" className="w-1/2" /><Skeleton variante="texto" className="w-24" /></div>
          </div>
        ))}
      </div>
    </SkeletonRegiao>
  );
}

/** Eventos (lista): dias com cartões de barra colorida, título, horário e etiquetas. */
export function SkeletonEventos({ rotulo, atrasoMs, className }: Base) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div className="flex flex-col gap-6">
        {[2, 1].map((n, g) => (
          <section key={g}>
            <CabecalhoGrupo largura="w-40" />
            <div className="flex flex-col gap-2">
              {Array.from({ length: n }, (_, i) => (
                <div key={i} data-bloco="evento" className="flex overflow-hidden rounded-2xl border border-border bg-surface-1">
                  <span className="w-1.5 shrink-0 bg-surface-3" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
                    <Skeleton variante="linha" className="w-1/2" />
                    <Skeleton variante="texto" className="w-1/3" />
                    <div className="mt-1 flex gap-1.5"><Skeleton variante="linha" className="h-5 w-16 rounded-pill" /><Skeleton variante="linha" className="h-5 w-20 rounded-pill" /></div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </SkeletonRegiao>
  );
}

/** Diálogo de evento (EditorEvento): cabeçalho, seções do formulário em 2 colunas e rodapé de botões. */
export function SkeletonEventoDialog({ rotulo, atrasoMs }: Base) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className="flex h-full w-full bg-black/40 lg:items-center lg:justify-center lg:p-6">
      <div className="flex h-full w-full flex-col bg-base lg:h-auto lg:max-w-5xl lg:rounded-2xl lg:border lg:border-border">
        <div data-bloco="cabecalho" className="flex flex-col gap-2 border-b border-border bg-surface-1 px-5 py-4 lg:rounded-t-2xl"><Skeleton variante="texto" className="w-24" /><Skeleton variante="bloco" className="h-8 w-64 rounded-lg" /><Skeleton variante="texto" className="w-32" /></div>
        <div className="grid gap-6 p-5 lg:grid-cols-2">
          {["titulo", "quando", "repeticao", "cor-categoria", "local", "descricao"].map((nome) => (
            <div key={nome} data-bloco="secao" className="flex flex-col gap-2"><Skeleton variante="texto" className="w-20" /><Skeleton variante="bloco" className={`w-full rounded-lg ${nome === "descricao" ? "h-24" : "h-10"}`} /></div>
          ))}
        </div>
        <div data-bloco="rodape" className="flex justify-end gap-3 border-t border-border px-5 py-4"><Skeleton variante="bloco" className="h-10 w-24 rounded-xl" /><Skeleton variante="bloco" className="h-10 w-28 rounded-xl" /></div>
      </div>
    </SkeletonRegiao>
  );
}

/** Rotina: voltar, título + texto, resumo, 6 cartões em 2 colunas e botão Salvar. */
export function SkeletonRotina({ rotulo, atrasoMs, className = "" }: Base) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={`mx-auto max-w-5xl px-4 pt-[calc(env(safe-area-inset-top)+12px)] ${className}`}>
      <Skeleton data-bloco="voltar" variante="linha" className="mb-4 w-20" />
      <Skeleton data-bloco="titulo" variante="linha" className="h-8 w-40" />
      <div className="mb-6 mt-2 max-w-2xl"><SkeletonTexto linhas={2} /></div>
      <Skeleton data-bloco="resumo" variante="bloco" className="mb-4 h-20 w-full" />
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} data-bloco="cartao-rotina" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-1 p-4">
            <div className="flex items-center gap-3"><Skeleton variante="circulo" className="h-9 w-9" /><div className="flex flex-1 flex-col gap-2"><Skeleton variante="linha" className="w-1/2" /><Skeleton variante="texto" className="w-5/6" /></div></div>
            <div className="flex gap-3"><Skeleton variante="bloco" className="h-10 flex-1 rounded-lg" /><Skeleton variante="bloco" className="h-10 flex-1 rounded-lg" /></div>
          </div>
        ))}
      </div>
      <Skeleton data-bloco="salvar" variante="bloco" className="mb-4 mt-6 h-[52px] w-full" />
    </SkeletonRegiao>
  );
}

/** Configurações > Sincronização: cartão de estado (ícone + 3 linhas) e cartão de modos (título + 3 opções). */
export function SkeletonSincronizacao({ rotulo, atrasoMs, className }: Base) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div data-bloco="estado" className="mb-3 flex items-start gap-3 rounded-2xl border border-border bg-surface-1 p-4">
        <Skeleton variante="circulo" className="mt-0.5 h-[22px] w-[22px]" />
        <div className="flex flex-1 flex-col gap-2"><Skeleton variante="linha" className="w-1/2" /><Skeleton variante="texto" className="w-5/6" /><Skeleton variante="texto" className="w-2/3" /></div>
      </div>
      <div data-bloco="modos" className="mb-5 rounded-2xl bg-surface-1 p-4">
        <Skeleton variante="linha" className="mb-3 w-16" />
        <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="flex items-start justify-between gap-3"><div className="flex flex-1 flex-col gap-2"><Skeleton variante="texto" className="w-1/3" /><Skeleton variante="texto" className="w-2/3" /></div><Skeleton variante="texto" className="w-12" /></div>)}</div>
      </div>
    </SkeletonRegiao>
  );
}

/** Cópias de segurança: linha de frequência e lista de arquivos (nome + tamanho), dentro do cartão do Cofre. */
export function SkeletonBackups({ itens = 3, rotulo, atrasoMs, className = "" }: Base & { itens?: number }) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={`mt-1 ${className}`}>
      <Skeleton data-bloco="frequencia" variante="texto" className="w-5/6" />
      <div className="mt-3 space-y-2">{Array.from({ length: itens }, (_, i) => <div key={i} data-bloco="copia" className="flex justify-between gap-3"><Skeleton variante="texto" className="w-1/2" /><Skeleton variante="texto" className="w-12" /></div>)}</div>
    </SkeletonRegiao>
  );
}

/** Organização de pastas: trilha de caminho e linhas de pasta. */
export function SkeletonOrganizacao({ itens = 4, rotulo, atrasoMs, className }: Base & { itens?: number }) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div data-bloco="trilha" className="mb-3 flex min-h-9 items-center gap-2 rounded-xl bg-surface-1 px-3"><Skeleton variante="texto" className="w-12" /></div>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface-1">
        {Array.from({ length: itens }, (_, i) => (
          <div key={i} data-bloco="pasta" className={`flex min-h-14 items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-border" : ""}`}>
            <Skeleton variante="bloco" className="h-9 w-9 rounded-xl" />
            <div className="flex flex-1 flex-col gap-2"><Skeleton variante="linha" className="w-1/3" /><Skeleton variante="texto" className="w-20" /></div>
          </div>
        ))}
      </div>
    </SkeletonRegiao>
  );
}

/** Pastas (navegador transversal): três seções (Notas, Tarefas, Arquivos) com cabeçalho e subpastas. */
export function SkeletonPastas({ rotulo, atrasoMs, className }: Base) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, g) => (
          <section key={g} data-bloco="secao" className="overflow-hidden rounded-2xl border border-border bg-surface-1">
            <div className="flex min-h-14 items-center gap-3 px-4"><Skeleton variante="bloco" className="h-9 w-9 rounded-xl" /><div className="flex flex-1 flex-col gap-2"><Skeleton variante="linha" className="w-1/4" /><Skeleton variante="texto" className="w-1/3" /></div></div>
            {Array.from({ length: 2 }, (_, i) => <div key={i} className="flex min-h-12 items-center gap-3 border-t border-border px-4"><Skeleton variante="texto" className="h-4 w-4" /><Skeleton variante="linha" className="w-1/2" /></div>)}
          </section>
        ))}
      </div>
    </SkeletonRegiao>
  );
}

/** Licenças: linhas de grupo (nome + resumo + seta). */
export function SkeletonLicencas({ itens = 4, rotulo, atrasoMs, className }: Base & { itens?: number }) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={className}>
      <div className="mt-3 space-y-2">
        {Array.from({ length: itens }, (_, i) => (
          <div key={i} data-bloco="grupo-licenca" className="flex items-center gap-3 rounded-xl border border-border bg-base p-3">
            <div className="flex flex-1 flex-col gap-2"><Skeleton variante="linha" className="w-1/3" /><Skeleton variante="texto" className="w-3/4" /></div>
            <Skeleton variante="texto" className="h-4 w-4" />
          </div>
        ))}
      </div>
    </SkeletonRegiao>
  );
}

/** Editar perfil: título, cartão do nome de usuário (campo + ajuda) e cartão de senha (2 campos, ajuda, botão). */
export function SkeletonEditarPerfil({ rotulo, atrasoMs, className = "" }: Base) {
  return (
    <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={`px-4 pt-[calc(env(safe-area-inset-top)+12px)] ${className}`}>
      <div data-bloco="titulo" className="mb-5 flex items-center gap-2"><Skeleton variante="circulo" className="h-[22px] w-[22px]" /><Skeleton variante="linha" className="h-6 w-32" /></div>
      <Skeleton variante="texto" className="mb-2 w-28" />
      <div data-bloco="cartao-usuario" className="mb-6 flex flex-col gap-2 rounded-2xl border border-border bg-surface-1 p-4"><Skeleton variante="texto" className="w-28" /><Skeleton variante="bloco" className="h-10 w-full rounded-lg" /><SkeletonTexto linhas={2} /></div>
      <Skeleton variante="texto" className="mb-2 w-24" />
      <div data-bloco="cartao-senha" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-1 p-4">
        <Campo rotulo="w-20" /><Campo rotulo="w-20" /><SkeletonTexto linhas={2} /><Skeleton variante="bloco" className="h-11 w-36 rounded-2xl" />
      </div>
    </SkeletonRegiao>
  );
}

/** Texto curto de estado dentro de um cartão (Google Calendar): duas linhas. */
export function SkeletonLinhasCartao({ rotulo, atrasoMs, className = "" }: Base) {
  return <SkeletonRegiao rotulo={rotulo} atrasoMs={atrasoMs} className={`mt-3 ${className}`}><SkeletonTexto linhas={2} /></SkeletonRegiao>;
}
