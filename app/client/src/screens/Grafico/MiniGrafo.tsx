import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Network } from "lucide-react";

import { graficoApi, type GraficoDados, type NoGrafico } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { prefsEfetivasMini, usePreferenciasGrafico } from "@/lib/preferencias-grafico";
import { vizinhancaLocal } from "./grafo-puro";
import { MotorGrafico } from "./motor-grafico";

function rotaDoNo(no: NoGrafico): string | null {
  if (no.tipo === "nota") return `/notas/nota/${no.id}`;
  if (no.tipo === "tarefa") return `/tarefa/${no.id}`;
  return null;
}

/** Grafo de exemplo da prévia nas Configurações: um item central com notas, tarefa, evento e tags, para ver cada cor e forma. */
const EXEMPLO: GraficoDados = {
  nos: [
    { id: "p-centro", tipo: "nota", titulo: "Item aberto", espaco: null, status: null },
    { id: "p-n1", tipo: "nota", titulo: "Ideias", espaco: null, status: null },
    { id: "p-n2", tipo: "nota", titulo: "Referências", espaco: null, status: null },
    { id: "p-t1", tipo: "tarefa", titulo: "Revisar texto", espaco: null, status: "pendente" },
    { id: "p-t2", tipo: "tarefa", titulo: "Enviar versão", espaco: null, status: "concluida" },
    { id: "p-e1", tipo: "evento", titulo: "Reunião", espaco: null, status: null },
    { id: "p-g1", tipo: "tag", titulo: "#projeto", espaco: null, status: null },
    { id: "p-g2", tipo: "tag", titulo: "#estudo", espaco: null, status: null },
  ],
  arestas: [
    { origem: "p-centro", destino: "p-n1", tipo: "wikilink" },
    { origem: "p-n2", destino: "p-centro", tipo: "wikilink" },
    { origem: "p-centro", destino: "p-t1", tipo: "evento_tarefa" },
    { origem: "p-e1", destino: "p-centro", tipo: "evento_nota" },
    { origem: "p-e1", destino: "p-t2", tipo: "evento_tarefa" },
    { origem: "p-centro", destino: "p-g1", tipo: "tag" },
    { origem: "p-n1", destino: "p-g1", tipo: "tag" },
    { origem: "p-n2", destino: "p-g2", tipo: "tag" },
    { origem: "p-t1", destino: "p-g2", tipo: "tag" },
  ],
};

/**
 * Mini gráfico local do modo Focus: só o item aberto e as conexões próximas. Aparência (cores, forças) segue o Gráfico;
 * ligar/desligar, profundidade, altura e tags vêm de Configurações › Gráfico › Mini gráfico.
 */
export function MiniGrafo({ itemId, semTitulo = false, previa = false }: { itemId: string; semTitulo?: boolean; previa?: boolean }) {
  const navigate = useNavigate();
  const { versao } = useRefreshBus();
  const [prefs] = usePreferenciasGrafico();
  const [dados, setDados] = useState<GraficoDados | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dica = useRef<HTMLDivElement>(null);
  const motor = useRef<MotorGrafico | null>(null);
  const recentes = useRef({ prefs, navigate });
  recentes.current = { prefs, navigate };

  useEffect(() => {
    if (!prefs.miniGrafo || previa) return;
    let ativo = true;
    graficoApi.obter().then((g) => { if (ativo) setDados(g); }).catch(() => { if (ativo) setDados({ nos: [], arestas: [] }); });
    return () => { ativo = false; };
  }, [versao, prefs.miniGrafo, previa]);

  const local = useMemo(
    () => previa ? vizinhancaLocal(EXEMPLO.nos, EXEMPLO.arestas, "p-centro", prefs.miniGrafoProfundidade, prefs.miniGrafoTags) : (dados ? vizinhancaLocal(dados.nos, dados.arestas, itemId, prefs.miniGrafoProfundidade, prefs.miniGrafoTags) : null),
    [previa, dados, itemId, prefs.miniGrafoProfundidade, prefs.miniGrafoTags],
  );
  const temConexoes = !!local && local.nos.length > 1;

  // O mini gráfico mostra tudo da vizinhança, mesmo que o Gráfico principal esteja filtrando tipos.
  const prefsMini = useMemo(
    () => ({ ...prefsEfetivasMini(prefs), tipos: { nota: true, tarefa: true, evento: true, tag: true }, mostrarSemConexao: true }),
    [prefs],
  );

  useEffect(() => {
    if ((!prefs.miniGrafo && !previa) || !temConexoes || !area.current || !canvas.current || !dica.current) return;
    const m = new MotorGrafico(area.current, canvas.current, dica.current, {
      onAbrir: (no) => { if (previa) return; const r = rotaDoNo(no); if (r) recentes.current.navigate(r); },
      onHover: () => {},
    }, prefsMini);
    motor.current = m;
    return () => { m.destruir(); motor.current = null; };
    // O motor nasce uma vez por item; dados e prefs entram pelos efeitos abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.miniGrafo, previa, temConexoes, itemId]);

  useEffect(() => { if (local) motor.current?.definirDados(local.nos, local.arestas); }, [local, temConexoes, itemId]);
  useEffect(() => { motor.current?.definirPrefs(prefsMini); }, [prefsMini]);

  if (!prefs.miniGrafo && !previa) return null;

  return (
    <section aria-label="Conexões" className="space-y-2">
      {!semTitulo && <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Conexões</h2>}
      {temConexoes ? (
        <div ref={area} className="relative overflow-hidden rounded-xl border border-border bg-surface-1" style={{ height: prefs.miniGrafoAltura }}>
          <canvas ref={canvas} className="block touch-none" role="img" aria-label="Mini gráfico das conexões deste item" />
          <div ref={dica} aria-hidden className="invisible absolute left-0 top-0" />
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-4 text-xs text-text-muted">
          <Network size={14} aria-hidden /> {dados ? "Sem conexões ainda. Use [[links]] e #tags para ligar este item." : "Carregando…"}
        </p>
      )}
    </section>
  );
}
