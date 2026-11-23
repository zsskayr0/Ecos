import { useContext, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useParams } from "react-router-dom";
import { Network } from "lucide-react";

import { links, notas, tarefas, type ConexoesItem } from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";
import { EstadoCarregando } from "@/components/common/EstadoCarregando";
import { TituloJanelaContext } from "@/lib/documento-popup";
import { guardarConexoes, lerConexoes } from "@/lib/conexoes-cache";
import { pedirIr, type AlvoIr } from "@/lib/ir-para";
import { dominio, rotuloCurto, useTitulosExternos } from "@/lib/links-externos";
import { useRefreshBus } from "@/lib/refresh-bus";
import { caminhoDe, useAbrirCaminho, type TipoItem } from "@/lib/wikilinks";
import { MapaConexoes, type NoMapa } from "./MapaConexoes";

const comTecla = (e: MouseEvent) => ({ ctrlKey: e.ctrlKey, metaKey: e.metaKey });

/**
 * Tela de conexões de uma nota ou tarefa (`/conexoes/:tipo/:id`): o mapa de tudo que se liga a ela. Cada cartão abre o
 * item (ou o link) e tem um botão "ver onde está", que abre o documento certo e rola suavemente até o trecho.
 */
export function ConexoesScreen() {
  const { tipo: tipoRota, id = "" } = useParams();
  const tipo: TipoItem = tipoRota === "tarefa" ? "tarefa" : "nota";
  const { versao } = useRefreshBus();
  const abrir = useAbrirCaminho();
  const definirTituloJanela = useContext(TituloJanelaContext);
  // Otimista: abre já com o que foi visto nos últimos 5 minutos e confere o servidor em seguida, trocando só se mudou.
  const guardado = lerConexoes(tipo, id);
  const [dados, setDados] = useState<ConexoesItem | null>(guardado?.dados ?? null);
  const [titulo, setTitulo] = useState<string | null>(guardado?.titulo ?? null);
  const [erro, setErro] = useState(false);
  const titulosExternos = useTitulosExternos(dados?.externos ?? []);

  useEffect(() => {
    if (!id) return;
    let ativo = true;
    setErro(false);
    const g = lerConexoes(tipo, id);
    setDados(g?.dados ?? null);
    setTitulo(g?.titulo ?? null);
    const obterTitulo = tipo === "tarefa" ? tarefas.obter(id) : notas.obter(id);
    Promise.all([links.de(tipo, id), obterTitulo.then((x) => x.titulo)])
      .then(([d, t]) => {
        guardarConexoes(tipo, id, { dados: d, titulo: t });
        if (!ativo) return;
        setDados((atual) => (JSON.stringify(atual) === JSON.stringify(d) ? atual : d));
        setTitulo(t);
      })
      .catch(() => { if (ativo && !g) setErro(true); }); // com cópia guardada, falha de rede não derruba a tela
    return () => { ativo = false; };
  }, [tipo, id, versao]);

  useEffect(() => { if (titulo) definirTituloJanela?.(`Conexões · ${titulo}`); }, [titulo, definirTituloJanela]);

  const nos = useMemo<NoMapa[]>(() => {
    if (!dados) return [];
    const interno = (lado: "entrada" | "saida") => (dados[lado] ?? []).map((x): NoMapa => ({ chave: `${lado}:${x.tipo ?? "nota"}:${x.id}`, lado, tipo: x.tipo === "tarefa" ? "tarefa" : "nota", titulo: x.titulo }));
    const externos = (dados.externos ?? []).map((e): NoMapa => ({ chave: `externo:${e.url}`, lado: "externo", tipo: "externo", titulo: titulosExternos[e.url] || e.texto || rotuloCurto(e.url), detalhe: dominio(e.url), href: e.url }));
    return [...interno("entrada"), ...interno("saida"), ...externos];
  }, [dados, titulosExternos]);

  if (erro && !dados) return <EmptyState icon={Network} title="Não foi possível carregar as conexões" subtitle="Verifique a conexão e tente de novo." />;
  if (!dados || titulo === null) return <EstadoCarregando texto="Carregando conexões…" />;

  const total = nos.length;
  const contar = (lado: NoMapa["lado"]) => nos.filter((n) => n.lado === lado).length;

  function abrirNo(no: NoMapa, e: MouseEvent) {
    const [, t, i] = no.chave.split(":");
    if (no.lado !== "externo") abrir(caminhoDe(t === "tarefa" ? "tarefa" : "nota", i!), comTecla(e));
  }

  /** Abre o documento em que a conexão aparece e pede o scroll até ela. */
  function verOnde(no: NoMapa, e: MouseEvent) {
    let doc: { tipo: TipoItem; id: string };
    let alvo: AlvoIr;
    if (no.lado === "externo") { doc = { tipo, id }; alvo = { url: no.href! }; }
    else if (no.lado === "saida") { doc = { tipo, id }; alvo = { wikilink: no.titulo }; }
    else { const [, t, i] = no.chave.split(":"); doc = { tipo: t === "tarefa" ? "tarefa" : "nota", id: i! }; alvo = { wikilink: titulo! }; }
    pedirIr(doc.id, alvo);
    abrir(caminhoDe(doc.tipo, doc.id), comTecla(e));
  }

  return (
    // O mapa É o painel: ocupa a janela inteira (sem caixa dentro da caixa) e o título fica sobre ele, no canto.
    <div className="relative h-full min-h-[26rem] w-full min-w-0">
      <header className="pointer-events-none absolute left-5 top-4 z-20 flex max-w-[min(42rem,60%)] flex-col gap-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Network size={18} className="text-steel-300" aria-hidden />Conexões</h1>
        <p className="text-sm text-text-secondary">
          {total
            ? `${contar("entrada")} ${contar("entrada") === 1 ? "menção" : "menções"} · ${contar("saida")} ${contar("saida") === 1 ? "link interno" : "links internos"} · ${contar("externo")} ${contar("externo") === 1 ? "link externo" : "links externos"}. Clique num item para centralizar; clique duas vezes (ou use o botão de abrir) para abrir. Role para aproximar ou afastar.`
            : "Esta " + tipo + " ainda não tem conexões."}
        </p>
      </header>
      <MapaConexoes centro={{ tipo, titulo }} nos={nos} aoAbrir={abrirNo} aoVerOnde={verOnde} aoAbrirCentro={(e) => abrir(caminhoDe(tipo, id), comTecla(e))} />
    </div>
  );
}
