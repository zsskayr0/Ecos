import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Network } from "lucide-react";

import { graficoApi, type GraficoDados, type NoGrafico } from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";
import { EstadoCarregando } from "@/components/common/EstadoCarregando";
import { mensagemDeErro } from "@/lib/erros";
import { useRefreshBus } from "@/lib/refresh-bus";
import { corDoTipo, ROTULO_TIPO_SINGULAR, usePreferenciasGrafico, type SecaoGrafico, type TipoGrafico } from "@/lib/preferencias-grafico";
import { MarcaTipo } from "./controles";
import { MotorGrafico, type InfoNoHover } from "./motor-grafico";
import { PainelGrafico } from "./PainelGrafico";

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
  const navigate = useNavigate();
  const { versao } = useRefreshBus();
  const [dados, setDados] = useState<GraficoDados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [prefs, alterar, redefinir] = usePreferenciasGrafico();
  /** Conteúdo da dica; fica no último nó mesmo depois de sair, para a dica desvanecer sem trocar de texto. */
  const [dicaInfo, setDicaInfo] = useState<InfoNoHover | null>(null);

  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dica = useRef<HTMLDivElement>(null);
  const motor = useRef<MotorGrafico | null>(null);
  const recentes = useRef({ dados, prefs, busca, navigate });
  recentes.current = { dados, prefs, busca, navigate };

  useEffect(() => {
    let ativo = true;
    graficoApi.obter().then((g) => { if (ativo) { setDados(g); setErro(null); } }).catch((e) => {
      if (ativo) { setDados({ nos: [], arestas: [] }); setErro(mensagemDeErro(e, "Não foi possível carregar o gráfico. Tente novamente.")); }
    });
    return () => { ativo = false; };
  }, [versao]);

  const temNos = !!dados && dados.nos.length > 0;

  useEffect(() => {
    if (!temNos || !area.current || !canvas.current || !dica.current) return;
    const m = new MotorGrafico(area.current, canvas.current, dica.current, {
      onAbrir: (no) => { const r = rotaDoNo(no); if (r) recentes.current.navigate(r); },
      onHover: (info) => { if (info) setDicaInfo(info); },
    }, recentes.current.prefs);
    motor.current = m;
    if (recentes.current.dados) m.definirDados(recentes.current.dados.nos, recentes.current.dados.arestas);
    m.definirBusca(recentes.current.busca);
    return () => { m.destruir(); motor.current = null; };
  }, [temNos]);

  useEffect(() => { if (dados) motor.current?.definirDados(dados.nos, dados.arestas); }, [dados]);
  useEffect(() => { motor.current?.definirPrefs(prefs); }, [prefs]);
  useEffect(() => { motor.current?.definirBusca(busca); }, [busca]);

  const contagens = useMemo(() => {
    const c: Record<TipoGrafico, number> = { nota: 0, tarefa: 0, evento: 0, tag: 0 };
    dados?.nos.forEach((n) => { c[n.tipo] += 1; });
    return c;
  }, [dados]);

  const abrirConfig = useCallback((secao: SecaoGrafico) => navigate(`/configuracoes/grafico#${secao}`), [navigate]);

  if (!dados) return <EstadoCarregando texto="Carregando gráfico…" />;

  const no = dicaInfo?.no;
  const espaco = no ? descreverEspaco(no.espaco) : null;

  return (
    <div className="flex h-full min-h-[60vh] flex-col px-4 pt-1 pb-nav-safe">
      <h1 className="mb-3 font-display text-2xl text-text-primary">Gráfico</h1>
      {erro && <p role="alert" className="mb-3 text-sm text-error">{erro}</p>}
      {!temNos && !erro ? (
        <EmptyState icon={Network} title="Nada para mostrar no gráfico." subtitle="Crie notas com [[links]] e #tags para ver as conexões aparecerem aqui." />
      ) : (
        <div ref={area} className="relative min-h-[420px] flex-1 overflow-hidden rounded-2xl">
          <canvas ref={canvas} className="block touch-none" role="img" aria-label="Gráfico de conexões entre notas, tarefas, eventos e tags" />
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
            onAbrirConfig={abrirConfig}
          />
        </div>
      )}
    </div>
  );
}
