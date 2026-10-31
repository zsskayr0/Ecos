import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Folder, Network, Orbit, Users, type LucideIcon } from "lucide-react";

import { graficoApi, type GraficoDados, type NoGrafico } from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";
import { EstadoCarregando } from "@/components/common/EstadoCarregando";
import { mensagemDeErro } from "@/lib/erros";
import { useRefreshBus } from "@/lib/refresh-bus";
import { corDoTipo, ROTULO_TIPO_SINGULAR, usePreferenciasGrafico, type SecaoGrafico, type TipoGrafico } from "@/lib/preferencias-grafico";
import { MarcaTipo } from "./controles";
import { MotorGrafico, type InfoNoHover } from "./motor-grafico";
import { PainelGrafico } from "./PainelGrafico";
import { chaveConstelacao, filtrarGalaxia, regiao, type FocoGalaxia } from "./galaxia";
import { useIsDesktop } from "@/lib/use-viewport";
import { useAppUI } from "@/lib/ui-context";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { completarPastasDoGrafico } from "./pastas-grafico";
import { MenuSuspenso } from "@/components/common/MenuSuspenso";
import { caminhoPastaNaRota } from "@/lib/pasta-contexto";

/** Rota que abre cada tipo de nó; evento não tem detalhe próprio, então cai na lista de Eventos. */
function rotaDoNo(no: NoGrafico): string | null {
  if (no.tipo === "nota") return `/notas/nota/${no.id}`;
  if (no.tipo === "tarefa") return `/tarefa/${no.id}`;
  if (no.tipo === "evento") return "/eventos";
  return null;
}

function descreverEspaco(espaco: string | null): string | null {
  if (!espaco) return null;
  return espaco === "pessoal" ? "Pessoal" : "Equipe";
}

export function GraficoScreen() {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const { espacoAtivo, setEspacoAtivo, intercalarEquipes, setIntercalarEquipes, filtroEquipeId, setFiltroEquipeId } = useAppUI();
  const espacoFiltro = useEspacoFiltro();
  const { equipes } = useMinhasEquipes();
  const { versao } = useRefreshBus();
  const [dados, setDados] = useState<GraficoDados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [foco, setFoco] = useState<FocoGalaxia>({ nivel: "universo" });
  const [prefs, alterar, redefinir] = usePreferenciasGrafico();
  /** Conteúdo da dica; fica no último nó mesmo depois de sair, para a dica desvanecer sem trocar de texto. */
  const [dicaInfo, setDicaInfo] = useState<InfoNoHover | null>(null);

  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dica = useRef<HTMLDivElement>(null);
  const motor = useRef<MotorGrafico | null>(null);
  const dadosRotulados = useMemo(() => dados && ({ ...dados, nos: dados.nos.map((n) => ({ ...n, nomeEspaco: n.espaco === "pessoal" ? "Pessoal" : equipes.find((e) => `equipe:${e.id}` === n.espaco)?.nome ?? "Equipe" })) }), [dados, equipes]);
  const recorte = useMemo(() => dadosRotulados ? filtrarGalaxia(dadosRotulados.nos, dadosRotulados.arestas, foco) : null, [dadosRotulados, foco]);
  const regioes = useMemo(() => {
    const mapa = new Map<string, { espaco: string; constelacao: string; nomeEspaco: string }>();
    for (const n of dadosRotulados?.nos ?? []) if (n.tipo !== "tag") {
      const r = regiao(n);
      mapa.set(chaveConstelacao(r), { espaco: r.espaco, constelacao: r.constelacao, nomeEspaco: n.nomeEspaco });
    }
    return [...mapa.values()].sort((a, b) => `${a.nomeEspaco} ${a.constelacao}`.localeCompare(`${b.nomeEspaco} ${b.constelacao}`));
  }, [dadosRotulados]);
  const sistemas = useMemo(() => [...new Set((dadosRotulados?.nos ?? []).filter((n) => n.tipo !== "tag" && regiao(n).espaco === foco.espaco && regiao(n).constelacao === foco.constelacao).map((n) => regiao(n).sistema))].sort(), [dadosRotulados, foco.espaco, foco.constelacao]);
  const planetas = useMemo(() => (dadosRotulados?.nos ?? []).filter((n) => n.tipo !== "tag" && regiao(n).espaco === foco.espaco && regiao(n).constelacao === foco.constelacao && regiao(n).sistema === foco.sistema).sort((a, b) => a.titulo.localeCompare(b.titulo)), [dadosRotulados, foco.espaco, foco.constelacao, foco.sistema]);
  const recentes = useRef({ dados: recorte, prefs, busca, navigate, intercalarEquipes, setIntercalarEquipes, setFiltroEquipeId, setEspacoAtivo });
  recentes.current = { dados: recorte, prefs, busca, navigate, intercalarEquipes, setIntercalarEquipes, setFiltroEquipeId, setEspacoAtivo };

  useEffect(() => {
    let ativo = true;
    setDados(null);
    graficoApi.obter(espacoFiltro).then(completarPastasDoGrafico).then((g) => { if (ativo) { setDados(g); setErro(null); } }).catch((e) => {
      if (ativo) { setDados({ nos: [], arestas: [] }); setErro(mensagemDeErro(e, "Não foi possível carregar o gráfico. Tente novamente.")); }
    });
    return () => { ativo = false; };
  }, [versao, espacoFiltro]);

  useEffect(() => { setFoco({ nivel: "universo" }); setDicaInfo(null); }, [espacoFiltro]);

  const temNos = !!dados && dados.nos.length > 0;

  useEffect(() => {
    if (!temNos || !area.current || !canvas.current || !dica.current) return;
    const m = new MotorGrafico(area.current, canvas.current, dica.current, {
      onAbrir: (no) => { const r = rotaDoNo(no); if (r) recentes.current.navigate(r); },
      onAbrirPasta: (pasta) => {
        if (pasta.tipo === "evento") { recentes.current.navigate("/eventos"); return; }
        const [espaco] = JSON.parse(pasta.chave.split("/")[0]) as [string];
        if (recentes.current.intercalarEquipes) {
          if (espaco.startsWith("equipe:")) recentes.current.setFiltroEquipeId(espaco.slice(7));
          else recentes.current.setIntercalarEquipes(false);
        }
        recentes.current.setEspacoAtivo(espaco);
        const raiz = pasta.tipo === "tarefa" ? "/tarefas" : "/notas";
        recentes.current.navigate(pasta.pasta ? `${raiz}/pasta/${caminhoPastaNaRota(pasta.pasta)}` : raiz);
      },
      onFocar: (no) => setFoco({ nivel: "planeta", ...regiao(no), id: no.id }),
      onHover: (info) => { if (info) setDicaInfo(info); },
    }, recentes.current.prefs, true);
    motor.current = m;
    m.definirFoco(foco);
    if (recentes.current.dados) m.definirDados(recentes.current.dados.nos, recentes.current.dados.arestas);
    m.definirBusca(recentes.current.busca);
    return () => { m.destruir(); motor.current = null; };
  }, [temNos]);

  useEffect(() => { if (recorte) { motor.current?.definirFoco(foco); motor.current?.definirDados(recorte.nos, recorte.arestas); motor.current?.ajustar(); } }, [recorte, foco]);
  useEffect(() => { motor.current?.definirPrefs(prefs); }, [prefs]);
  useEffect(() => { motor.current?.definirBusca(busca); }, [busca]);

  const contagens = useMemo(() => {
    const c: Record<TipoGrafico, number> = { nota: 0, tarefa: 0, evento: 0, tag: 0 };
    recorte?.nos.forEach((n) => { c[n.tipo] += 1; });
    return c;
  }, [recorte]);

  const abrirConfig = useCallback((secao: SecaoGrafico) => navigate(`/configuracoes/grafico#${secao}`), [navigate]);

  if (!dados) return <EstadoCarregando texto="Carregando gráfico…" />;

  const no = dicaInfo?.no;
  const espaco = no ? no.nomeEspaco ?? descreverEspaco(no.espaco) : null;

  return (
    <div className={`flex h-full min-h-[60vh] flex-col px-4 pt-1 ${desktop ? "pb-0" : "pb-nav-safe"}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="pt-[14px] font-display text-3xl font-semibold tracking-tight text-text-primary">Galáxia</h1><p className="text-xs text-text-muted">{dados.nos.length} astros · {dados.arestas.length} ligações</p></div>
        <div className="flex items-center gap-2 text-xs text-text-muted"><span>Equipe</span>
          <SeletorGalaxia ariaLabel="Filtrar galáxia por equipe" icone={Users} tema="app" valor={intercalarEquipes ? filtroEquipeId ?? "" : espacoAtivo} onChange={(valor) => intercalarEquipes ? setFiltroEquipeId(valor || null) : setEspacoAtivo(valor)} opcoes={[
            { valor: intercalarEquipes ? "" : "pessoal", rotulo: intercalarEquipes ? "Todas as equipes" : "Pessoal" },
            ...equipes.map((e) => ({ valor: intercalarEquipes ? e.id : `equipe:${e.id}`, rotulo: e.nome })),
          ]} />
        </div>
      </div>
      {erro && <p role="alert" className="mb-3 text-sm text-error">{erro}</p>}
      {!temNos && !erro ? (
        <EmptyState icon={Network} title="Nada para mostrar no gráfico." subtitle="Crie notas com [[links]] e #tags para ver as conexões aparecerem aqui." />
      ) : (
        <div ref={area} className="relative min-h-[420px] flex-1 overflow-hidden rounded-t-2xl bg-[#050713] text-slate-200">
          <canvas ref={canvas} className="block touch-none" role="img" aria-label="Gráfico de conexões entre notas, tarefas, eventos e tags" />
          <nav aria-label="Níveis da galáxia" className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-[#0c1222]/85 p-1.5 text-xs text-slate-200 shadow-lg backdrop-blur-md sm:max-w-[calc(100%-20rem)]">
            <button type="button" onClick={() => setFoco({ nivel: "universo" })} className={`rounded-lg px-2 py-1 ${foco.nivel === "universo" ? "bg-white/15 text-white" : "hover:bg-white/10"}`}>Universo</button>
            <span aria-hidden className="text-slate-500">/</span>
            <SeletorGalaxia ariaLabel="Constelação" icone={Folder} valor={foco.constelacao ? chaveConstelacao({ espaco: foco.espaco ?? "pessoal", constelacao: foco.constelacao }) : ""} onChange={(valor) => { const r = regioes.find((item) => chaveConstelacao(item) === valor); setFoco(r ? { nivel: "constelacao", espaco: r.espaco, constelacao: r.constelacao } : { nivel: "universo" }); }} opcoes={[
              { valor: "", rotulo: "Constelações" },
              ...regioes.map((r) => ({ valor: chaveConstelacao(r), rotulo: r.espaco === "pessoal" ? r.constelacao : `${r.nomeEspaco} · ${r.constelacao}` })),
            ]} />
            {foco.constelacao && <><span aria-hidden className="text-slate-500">/</span><SeletorGalaxia ariaLabel="Sistema solar" icone={Orbit} valor={foco.sistema ?? ""} onChange={(valor) => setFoco(valor ? { nivel: "sistema", espaco: foco.espaco, constelacao: foco.constelacao, sistema: valor } : { nivel: "constelacao", espaco: foco.espaco, constelacao: foco.constelacao })} opcoes={[{ valor: "", rotulo: "Sistemas" }, ...sistemas.map((s) => ({ valor: s, rotulo: s }))]} /></>}
            {foco.sistema && <><span aria-hidden className="text-slate-500">/</span><SeletorGalaxia ariaLabel="Planeta" icone={Orbit} valor={foco.id ?? ""} buscar onChange={(valor) => setFoco(valor ? { nivel: "planeta", espaco: foco.espaco, constelacao: foco.constelacao, sistema: foco.sistema, id: valor } : { nivel: "sistema", espaco: foco.espaco, constelacao: foco.constelacao, sistema: foco.sistema })} opcoes={[{ valor: "", rotulo: "Planetas" }, ...planetas.map((n) => ({ valor: n.id, rotulo: n.titulo }))]} /></>}
          </nav>
          {prefs.legenda && <div aria-label="Legenda do gráfico" className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-[#0c1222]/85 px-3 py-2 text-[11px] text-slate-300 backdrop-blur-md">{(["nota", "tarefa", "evento", "tag"] as const).map((tipo) => <span key={tipo} className="flex items-center gap-1.5"><MarcaTipo tipo={tipo} cor={corDoTipo(prefs, tipo)} tamanho={8} />{ROTULO_TIPO_SINGULAR[tipo]}{tipo === "tag" ? " · lua" : ""}</span>)}</div>}
          <div
            ref={dica}
            aria-hidden
            className="pointer-events-none invisible absolute left-0 top-0 z-20 max-w-[16rem] rounded-xl border border-border bg-surface-raised/95 px-3 py-2 opacity-0 shadow-xl backdrop-blur-md will-change-transform"
          >
            {no && (
              <>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
                  <MarcaTipo tipo={no.tipo} cor={corDoTipo(prefs, no.tipo)} tamanho={8} />
                  {ROTULO_TIPO_SINGULAR[no.tipo]}
                  {no.status === "concluida" && <span className="rounded bg-surface-3 px-1 py-px text-[10px] text-text-secondary">Concluída</span>}
                </div>
                <p className="mt-1 break-words text-sm font-medium leading-snug text-text-primary">{no.titulo}</p>
                <p className="mt-1 text-[11px] text-text-muted">
                  {dicaInfo!.grau === 0 ? "Sem conexões" : dicaInfo!.grau === 1 ? "1 conexão" : `${dicaInfo!.grau} conexões`}
                  {espaco ? ` · ${espaco}` : ""}
                </p>
                {no.tipo !== "tag" && <p className="mt-1 text-[10px] text-text-muted">Shift + clique: ver planeta</p>}
              </>
            )}
          </div>
          <PainelGrafico
            prefs={prefs}
            alterar={alterar}
            redefinir={redefinir}
            contagens={contagens}
            busca={busca}
            onBusca={setBusca}
            onAjustar={() => motor.current?.ajustar()}
            onReorganizar={() => motor.current?.redefinirPosicoes()}
            onAbrirConfig={abrirConfig}
          />
          <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-xl border border-white/10 bg-[#0c1222]/85 p-1 text-slate-200 shadow-lg backdrop-blur-md">
            <button type="button" aria-label="Aproximar" onClick={() => motor.current?.zoom(1.25)} className="rounded-lg px-2 py-1 hover:bg-white/10">+</button>
            <button type="button" aria-label="Afastar" onClick={() => motor.current?.zoom(0.8)} className="rounded-lg px-2 py-1 hover:bg-white/10">−</button>
            <button type="button" aria-label="Enquadrar galáxia" onClick={() => motor.current?.ajustar()} className="rounded-lg px-2 py-1 text-xs hover:bg-white/10">Ajustar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SeletorGalaxia({ ariaLabel, icone: Icone, valor, opcoes, onChange, tema = "galaxia", buscar = false }: { ariaLabel: string; icone: LucideIcon; valor: string; opcoes: { valor: string; rotulo: string }[]; onChange: (valor: string) => void; tema?: "galaxia" | "app"; buscar?: boolean }) {
  return <MenuSuspenso valor={valor} opcoes={opcoes} onChange={onChange} ariaLabel={ariaLabel} buscar={buscar} larguraMenu="w-56 max-w-[calc(100vw-2rem)]"
    classeGatilho={`flex h-8 max-w-48 items-center gap-1.5 rounded-lg border px-2 text-left text-xs transition-colors ${tema === "galaxia" ? "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" : "border-border bg-surface-1 text-text-primary hover:bg-surface-2"}`}
    gatilho={({ aberto, atual }) => <><Icone size={13} className="shrink-0 opacity-70" /><span className="min-w-0 flex-1 truncate">{atual?.rotulo ?? opcoes[0]?.rotulo}</span><ChevronDown size={13} className={`shrink-0 opacity-70 transition-transform ${aberto ? "rotate-180" : ""}`} /></>} />;
}
