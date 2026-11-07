/**
 * Estado da tinta de uma Nota: carrega, aplica operações (com desfazer/refazer) e grava com
 * debounce (~800 ms) e flush no `pagehide`/desmontagem. 409 = outra aba gravou: a tinta local
 * fica na tela e a pessoa escolhe recarregar a do servidor.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, notas } from "@/lib/api";
import { mensagemDeErro } from "@/lib/erros";
import { aplicar, desfazer as desfazerOp, historicoVazio, refazer as refazerOp, registrar, type Historico, type Operacao } from "./historico";
import { ativos, LARGURA_COLUNA_PADRAO, type Traco } from "./tipos";

export const ATRASO_GRAVACAO_MS = 800;

export type EstadoGravacao = "ocioso" | "pendente" | "salvando" | "salvo" | "erro" | "conflito";

export interface TintaControle {
  carregado: boolean;
  tracos: Traco[];
  /** `null` = Nota não convertida (largura fluida). */
  largura: number | null;
  estado: EstadoGravacao;
  erro: string | null;
  podeDesfazer: boolean;
  podeRefazer: boolean;
  executar: (op: Operacao) => void;
  desfazer: () => void;
  refazer: () => void;
  /** Aceite do aviso: a coluna passa a ser fixa nesta largura (só grava com o 1º traço). */
  converter: (largura?: number) => void;
  recarregar: () => void;
  /** Saiu do Modo de escrita sem nenhum traço: volta a não convertida (o aviso reaparece). */
  soltarSeVazia: () => void;
  gravarAgora: () => Promise<void>;
}

export function useTinta(notaId: string | undefined): TintaControle {
  const [carregado, setCarregado] = useState(false);
  const [tracos, setTracos] = useState<Traco[]>([]);
  const [largura, setLargura] = useState<number | null>(null);
  const [hist, setHist] = useState<Historico>(historicoVazio);
  const [estado, setEstado] = useState<EstadoGravacao>("ocioso");
  const [erro, setErro] = useState<string | null>(null);
  const [versaoCarga, setVersaoCarga] = useState(0);
  const revisao = useRef(0);
  const sujo = useRef(false);
  const emCurso = useRef<Promise<void> | null>(null);
  const tracosRef = useRef(tracos);
  tracosRef.current = tracos;
  const larguraRef = useRef(largura);
  larguraRef.current = largura;
  const histRef = useRef(hist);
  histRef.current = hist;

  useEffect(() => {
    if (!notaId) return;
    let ativo = true;
    setCarregado(false);
    notas.tinta.obter(notaId).then((t) => {
      if (!ativo) return;
      revisao.current = t.revisao;
      sujo.current = false;
      setTracos(t.tracos);
      setLargura(t.largura_coluna);
      setHist(historicoVazio());
      setEstado("ocioso");
      setErro(null);
      setCarregado(true);
    }).catch((e) => {
      if (!ativo) return;
      // Sem tinta legível a Nota segue como texto; o erro aparece se a pessoa tentar desenhar.
      setErro(mensagemDeErro(e, "Não foi possível carregar as anotações."));
      setCarregado(true);
    });
    return () => { ativo = false; };
  }, [notaId, versaoCarga]);

  const gravarAgora = useCallback(async (): Promise<void> => {
    if (!notaId) return;
    if (emCurso.current) { await emCurso.current; if (!sujo.current) return; }
    if (!sujo.current) return;
    sujo.current = false;
    const lista = tracosRef.current;
    const pedido = (async () => {
      setEstado("salvando");
      try {
        const r = await notas.tinta.salvar(notaId, { revisao_base: revisao.current, largura_coluna: larguraRef.current ?? LARGURA_COLUNA_PADRAO, tracos: lista });
        revisao.current = r.revisao;
        setEstado(sujo.current ? "pendente" : "salvo");
        setErro(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setEstado("conflito");
          setErro("As anotações desta Nota mudaram em outro lugar. Recarregue para ver a versão salva (o que você desenhou aqui desde a última gravação se perde).");
        } else {
          sujo.current = true;
          setEstado("erro");
          setErro(mensagemDeErro(e, "Não foi possível salvar as anotações."));
        }
      }
    })();
    emCurso.current = pedido;
    try { await pedido; } finally { emCurso.current = null; }
  }, [notaId]);

  const marcarSujo = useCallback(() => { sujo.current = true; setEstado((s) => (s === "conflito" ? s : "pendente")); }, []);

  useEffect(() => {
    if (estado !== "pendente") return;
    const t = window.setTimeout(() => { void gravarAgora(); }, ATRASO_GRAVACAO_MS);
    return () => window.clearTimeout(t);
  }, [estado, tracos, gravarAgora]);

  useEffect(() => {
    const aoSair = () => { void gravarAgora(); };
    window.addEventListener("pagehide", aoSair);
    return () => { window.removeEventListener("pagehide", aoSair); void gravarAgora(); };
  }, [gravarAgora]);

  const executar = useCallback((op: Operacao) => {
    if (op.tipo === "apagar" && !op.ids.length) return;
    setTracos((t) => aplicar(t, op));
    setHist((h) => registrar(h, op));
    setLargura((l) => l ?? LARGURA_COLUNA_PADRAO);
    marcarSujo();
  }, [marcarSujo]);

  const desfazer = useCallback(() => {
    const r = desfazerOp(histRef.current, tracosRef.current);
    if (!r) return;
    setHist(r.h); setTracos(r.tracos); setLargura((l) => l ?? LARGURA_COLUNA_PADRAO); marcarSujo();
  }, [marcarSujo]);

  const refazer = useCallback(() => {
    const r = refazerOp(histRef.current, tracosRef.current);
    if (!r) return;
    setHist(r.h); setTracos(r.tracos); setLargura((l) => l ?? LARGURA_COLUNA_PADRAO); marcarSujo();
  }, [marcarSujo]);

  const converter = useCallback((l = LARGURA_COLUNA_PADRAO) => setLargura((atual) => atual ?? l), []);
  const recarregar = useCallback(() => setVersaoCarga((v) => v + 1), []);
  const soltarSeVazia = useCallback(() => { if (!ativos(tracosRef.current).length) setLargura(null); }, []);

  // Sem nenhum traço ativo e já gravado: o servidor apagou os arquivos; a Nota volta a não convertida.
  // As lápides ficam na lista local para o desfazer ainda poder trazer os traços de volta.
  useEffect(() => {
    if (estado === "salvo" && ativos(tracos).length === 0) setLargura(null);
  }, [estado, tracos]);

  return {
    carregado, tracos, largura, estado, erro,
    podeDesfazer: hist.feitas.length > 0, podeRefazer: hist.desfeitas.length > 0,
    executar, desfazer, refazer, converter, recarregar, soltarSeVazia, gravarAgora,
  };
}
