import { useCallback, useEffect, useState } from "react";

export type TipoGrafico = "nota" | "tarefa" | "evento" | "tag";
export type RotulosGrafico = "auto" | "sempre" | "hover" | "nunca";

export const TIPOS_GRAFICO: TipoGrafico[] = ["nota", "tarefa", "evento", "tag"];
export const ROTULOS_TIPO: Record<TipoGrafico, string> = { nota: "Notas", tarefa: "Tarefas", evento: "Eventos", tag: "Tags" };
export const ROTULO_TIPO_SINGULAR: Record<TipoGrafico, string> = { nota: "Nota", tarefa: "Tarefa", evento: "Evento", tag: "Tag" };

/** Seções da tela de configurações do Gráfico: o painel flutuante aponta para elas pelo `#id`. */
export type SecaoGrafico = "filtros" | "cores" | "exibicao" | "forcas" | "animacao";

export interface PreferenciasGrafico {
  /* Cores por tipo */
  corNota: string;
  corTarefa: string;
  corEvento: string;
  corTag: string;
  /* Filtros */
  tipos: Record<TipoGrafico, boolean>;
  mostrarSemConexao: boolean;
  /* Exibição */
  tamanhoNos: number;
  espessuraLinhas: number;
  tamanhoTexto: number;
  rotulos: RotulosGrafico;
  setas: boolean;
  esmaecerConcluidas: boolean;
  dicaSegueMouse: boolean;
  /* Forças */
  repulsao: number;
  distancia: number;
  gravidade: number;
  /* Animação */
  movimentoOcioso: boolean;
  intensidadeMovimento: number;
  velocidadeAnimacao: number;
}

export const PADRAO_PREFERENCIAS_GRAFICO: PreferenciasGrafico = {
  corNota: "#7a9cf0",
  corTarefa: "#e9a45f",
  corEvento: "#a98bea",
  corTag: "#62c4a0",
  tipos: { nota: true, tarefa: true, evento: true, tag: true },
  mostrarSemConexao: true,
  tamanhoNos: 1,
  espessuraLinhas: 1,
  tamanhoTexto: 11,
  rotulos: "auto",
  setas: false,
  esmaecerConcluidas: true,
  dicaSegueMouse: true,
  repulsao: 70,
  distancia: 46,
  gravidade: 0.04,
  movimentoOcioso: true,
  intensidadeMovimento: 1,
  velocidadeAnimacao: 1,
};

export const LIMITES_GRAFICO = {
  tamanhoNos: { min: 0.5, max: 2.5, passo: 0.05 },
  espessuraLinhas: { min: 0.4, max: 3, passo: 0.1 },
  tamanhoTexto: { min: 9, max: 18, passo: 1 },
  repulsao: { min: 10, max: 220, passo: 5 },
  distancia: { min: 20, max: 140, passo: 2 },
  gravidade: { min: 0, max: 0.2, passo: 0.005 },
  intensidadeMovimento: { min: 0, max: 2.5, passo: 0.05 },
  velocidadeAnimacao: { min: 0.4, max: 2.5, passo: 0.05 },
} as const;

export const CORES_PREDEFINIDAS = ["#7a9cf0", "#5b8def", "#62c4a0", "#e9a45f", "#e8788a", "#a98bea", "#e2c15e", "#8d99ab", "#4fb8d6", "#d97fc4"];

export const CHAVE_PREFERENCIAS_GRAFICO = "ecos:preferencias-grafico:v1";
const EVENTO = "ecos:preferencias-grafico";

const HEX = /^#[0-9a-fA-F]{6}$/;
const limitar = (v: unknown, min: number, max: number, padrao: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao);

/** Lê do armazenamento sem confiar nele: valor ausente, de outro tipo ou fora do limite volta ao padrão. */
export function lerPreferenciasGrafico(): PreferenciasGrafico {
  const p = PADRAO_PREFERENCIAS_GRAFICO;
  let bruto: Record<string, unknown> = {};
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_PREFERENCIAS_GRAFICO) ?? "null");
    if (salvo && typeof salvo === "object") bruto = salvo as Record<string, unknown>;
  } catch { /* sem armazenamento: usa o padrão */ }
  const cor = (v: unknown, padrao: string) => (typeof v === "string" && HEX.test(v) ? v : padrao);
  const bool = (v: unknown, padrao: boolean) => (typeof v === "boolean" ? v : padrao);
  const tiposBruto = (bruto.tipos && typeof bruto.tipos === "object" ? bruto.tipos : {}) as Record<string, unknown>;
  const L = LIMITES_GRAFICO;
  return {
    corNota: cor(bruto.corNota, p.corNota),
    corTarefa: cor(bruto.corTarefa, p.corTarefa),
    corEvento: cor(bruto.corEvento, p.corEvento),
    corTag: cor(bruto.corTag, p.corTag),
    tipos: {
      nota: bool(tiposBruto.nota, true),
      tarefa: bool(tiposBruto.tarefa, true),
      evento: bool(tiposBruto.evento, true),
      tag: bool(tiposBruto.tag, true),
    },
    mostrarSemConexao: bool(bruto.mostrarSemConexao, p.mostrarSemConexao),
    tamanhoNos: limitar(bruto.tamanhoNos, L.tamanhoNos.min, L.tamanhoNos.max, p.tamanhoNos),
    espessuraLinhas: limitar(bruto.espessuraLinhas, L.espessuraLinhas.min, L.espessuraLinhas.max, p.espessuraLinhas),
    tamanhoTexto: limitar(bruto.tamanhoTexto, L.tamanhoTexto.min, L.tamanhoTexto.max, p.tamanhoTexto),
    rotulos: (["auto", "sempre", "hover", "nunca"] as const).includes(bruto.rotulos as RotulosGrafico) ? (bruto.rotulos as RotulosGrafico) : p.rotulos,
    setas: bool(bruto.setas, p.setas),
    esmaecerConcluidas: bool(bruto.esmaecerConcluidas, p.esmaecerConcluidas),
    dicaSegueMouse: bool(bruto.dicaSegueMouse, p.dicaSegueMouse),
    repulsao: limitar(bruto.repulsao, L.repulsao.min, L.repulsao.max, p.repulsao),
    distancia: limitar(bruto.distancia, L.distancia.min, L.distancia.max, p.distancia),
    gravidade: limitar(bruto.gravidade, L.gravidade.min, L.gravidade.max, p.gravidade),
    movimentoOcioso: bool(bruto.movimentoOcioso, p.movimentoOcioso),
    intensidadeMovimento: limitar(bruto.intensidadeMovimento, L.intensidadeMovimento.min, L.intensidadeMovimento.max, p.intensidadeMovimento),
    velocidadeAnimacao: limitar(bruto.velocidadeAnimacao, L.velocidadeAnimacao.min, L.velocidadeAnimacao.max, p.velocidadeAnimacao),
  };
}

export function salvarPreferenciasGrafico(preferencias: PreferenciasGrafico) {
  try { localStorage.setItem(CHAVE_PREFERENCIAS_GRAFICO, JSON.stringify(preferencias)); } catch { /* dispositivo sem armazenamento persistente */ }
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: preferencias }));
}

export function corDoTipo(preferencias: PreferenciasGrafico, tipo: TipoGrafico): string {
  return { nota: preferencias.corNota, tarefa: preferencias.corTarefa, evento: preferencias.corEvento, tag: preferencias.corTag }[tipo];
}

export function chaveCorDoTipo(tipo: TipoGrafico): "corNota" | "corTarefa" | "corEvento" | "corTag" {
  return ({ nota: "corNota", tarefa: "corTarefa", evento: "corEvento", tag: "corTag" } as const)[tipo];
}

/**
 * Preferências do Gráfico com gravação imediata. O painel flutuante e a tela de Configurações usam o mesmo hook:
 * mexer em um reflete no outro (e no canvas) sem recarregar nada.
 */
export function usePreferenciasGrafico(): [PreferenciasGrafico, (patch: Partial<PreferenciasGrafico>) => void, () => void] {
  const [prefs, setPrefs] = useState(lerPreferenciasGrafico);
  useEffect(() => {
    const aoMudar = (e: Event) => setPrefs((e as CustomEvent<PreferenciasGrafico>).detail);
    window.addEventListener(EVENTO, aoMudar);
    return () => window.removeEventListener(EVENTO, aoMudar);
  }, []);
  const alterar = useCallback((patch: Partial<PreferenciasGrafico>) => {
    salvarPreferenciasGrafico({ ...lerPreferenciasGrafico(), ...patch });
  }, []);
  const redefinir = useCallback(() => salvarPreferenciasGrafico({ ...PADRAO_PREFERENCIAS_GRAFICO, tipos: { ...PADRAO_PREFERENCIAS_GRAFICO.tipos } }), []);
  return [prefs, alterar, redefinir];
}
