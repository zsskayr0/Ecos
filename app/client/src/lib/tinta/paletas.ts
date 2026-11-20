/**
 * Grupos de cores da caneta e do marca-texto: os prontos (fixos) e os do usuário (salvos neste aparelho).
 * A cor de um traço é sempre `"auto"` (cor do texto do tema) ou `#rrggbb`, que é o que o servidor aceita.
 */
import { useSyncExternalStore } from "react";
import type { Ferramenta } from "./tipos";

export interface GrupoCores { id: string; nome: string; cores: string[]; proprio: boolean }

export const MAX_CORES_GRUPO = 24;
/** Grupo especial: aparece primeiro, com estrela, e só existe enquanto houver uma cor favorita. */
export const ID_FAVORITOS = "favoritos";
export const MAX_GRUPOS_PROPRIOS = 12;
const CHAVE = "ecos.paletas-tinta";

const pronto = (id: string, nome: string, cores: string[]): GrupoCores => ({ id, nome, cores, proprio: false });


/** Vivas é o primeiro grupo. Na caneta ela cede a última cor à "cor do texto" (muda com o tema), que senão não teria onde ser escolhida. */
const VIVAS = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e"];
const vivas = (f: Ferramenta) => pronto("vivas", "Vivas", f === "caneta" ? ["auto", ...VIVAS.slice(0, 11)] : VIVAS);

const COMUNS: GrupoCores[] = [
  pronto("pastel", "Pastel", ["#fca5a5", "#fdba74", "#fde047", "#d9f99d", "#86efac", "#99f6e4", "#67e8f9", "#93c5fd", "#c7d2fe", "#c4b5fd", "#f9a8d4", "#fecdd3"]),
  pronto("oceano", "Oceano", ["#1e3a8a", "#4f46e5", "#0c4a6e", "#164e63", "#0369a1", "#0891b2", "#14b8a6", "#0ea5e9", "#38bdf8", "#5eead4", "#67e8f9", "#bae6fd"]),
  pronto("cinzas", "Cinzas", ["#0a0a0a", "#171717", "#262626", "#404040", "#525252", "#737373", "#8c8c8c", "#a3a3a3", "#bfbfbf", "#d4d4d4", "#e5e5e5", "#fafafa"]),
];

export function gruposProntos(ferramenta: Ferramenta): GrupoCores[] {
  return [vivas(ferramenta), ...COMUNS];
}

/** Os grupos do usuário valem para as duas ferramentas; o grupo escolhido é lembrado por ferramenta. */
export interface EstadoPaletas { grupos: GrupoCores[]; favoritos?: string[]; escolhido: Partial<Record<Ferramenta, string>>; slots?: Partial<Record<Ferramenta, SlotsCor>> }

/** Três seletores de cor independentes por ferramenta; cada um guarda a última cor escolhida nele. */
export interface SlotsCor { cores: string[]; ativo: number }
export const NUM_SLOTS = 3;
export const SLOTS_PADRAO: Record<Ferramenta, SlotsCor> = {
  caneta: { cores: ["auto", "#2563eb", "#dc2626"], ativo: 0 },
  "marca-texto": { cores: ["#facc15", "#4ade80", "#f472b6"], ativo: 0 },
};

const VAZIO: EstadoPaletas = { grupos: [], escolhido: {} };

const corValida = (c: unknown): c is string => c === "auto" || (typeof c === "string" && normalizarHex(c) === c);

export function lerSlots(e: EstadoPaletas, f: Ferramenta): SlotsCor {
  const base = SLOTS_PADRAO[f], s = e.slots?.[f];
  if (!s || !Array.isArray(s.cores)) return base;
  const cores = Array.from({ length: NUM_SLOTS }, (_, i) => (corValida(s.cores[i]) && (f === "caneta" || s.cores[i] !== "auto") ? s.cores[i]! : base.cores[i]!));
  return { cores, ativo: Number.isInteger(s.ativo) && s.ativo >= 0 && s.ativo < NUM_SLOTS ? s.ativo : 0 };
}

export function definirSlot(e: EstadoPaletas, f: Ferramenta, i: number, cor: string): EstadoPaletas {
  if (i < 0 || i >= NUM_SLOTS || !corValida(cor)) return e;
  const s = lerSlots(e, f);
  if (s.cores[i] === cor) return e;
  return { ...e, slots: { ...e.slots, [f]: { ...s, cores: s.cores.map((c, k) => (k === i ? cor : c)) } } };
}

export function ativarSlot(e: EstadoPaletas, f: Ferramenta, i: number): EstadoPaletas {
  const s = lerSlots(e, f);
  return i < 0 || i >= NUM_SLOTS || s.ativo === i ? e : { ...e, slots: { ...e.slots, [f]: { ...s, ativo: i } } };
}

// --- cor ---------------------------------------------------------------------------------------

/** `#abc`, `abc`, `#AABBCC` → `#aabbcc`; qualquer outra coisa → `null`. */
export function normalizarHex(texto: string): string | null {
  const t = texto.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t)) return `#${t[0]}${t[0]}${t[1]}${t[1]}${t[2]}${t[2]}`;
  return /^[0-9a-f]{6}$/.test(t) ? `#${t}` : null;
}

export interface Hsv { h: number; s: number; v: number }

/** h em 0–360, s e v em 0–1. */
export function hsvParaHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const c = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${c(f(5))}${c(f(3))}${c(f(1))}`;
}

export function hexParaHsv(hex: string): Hsv {
  const n = normalizarHex(hex) ?? "#000000";
  const r = parseInt(n.slice(1, 3), 16) / 255, g = parseInt(n.slice(3, 5), 16) / 255, b = parseInt(n.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

// --- operações puras sobre o estado --------------------------------------------------------------

const novoId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function nomeNovoGrupo(grupos: readonly GrupoCores[]): string {
  for (let i = grupos.length + 1; ; i++) { const n = `Meu grupo ${i}`; if (!grupos.some((g) => g.nome === n)) return n; }
}

export function criarGrupo(e: EstadoPaletas, nome?: string, cores: string[] = []): { estado: EstadoPaletas; id: string | null } {
  if (e.grupos.length >= MAX_GRUPOS_PROPRIOS) return { estado: e, id: null };
  const g: GrupoCores = { id: novoId(), nome: (nome ?? "").trim().slice(0, 24) || nomeNovoGrupo(e.grupos), cores: cores.slice(0, MAX_CORES_GRUPO), proprio: true };
  return { estado: { ...e, grupos: [...e.grupos, g] }, id: g.id };
}

export function renomearGrupo(e: EstadoPaletas, id: string, nome: string): EstadoPaletas {
  const n = nome.trim().slice(0, 24);
  return n ? { ...e, grupos: e.grupos.map((g) => (g.id === id ? { ...g, nome: n } : g)) } : e;
}

export function excluirGrupo(e: EstadoPaletas, id: string): EstadoPaletas {
  const escolhido = { ...e.escolhido };
  for (const f of Object.keys(escolhido) as Ferramenta[]) if (escolhido[f] === id) delete escolhido[f];
  return { ...e, grupos: e.grupos.filter((g) => g.id !== id), escolhido };
}

export function alternarFavorito(e: EstadoPaletas, cor: string): EstadoPaletas {
  const hex = normalizarHex(cor);
  if (!hex) return e;
  const atuais = e.favoritos ?? [];
  if (atuais.includes(hex)) return { ...e, favoritos: atuais.filter((c) => c !== hex) };
  return atuais.length >= MAX_CORES_GRUPO ? e : { ...e, favoritos: [...atuais, hex] };
}

export function adicionarCor(e: EstadoPaletas, id: string, cor: string): EstadoPaletas {
  const hex = normalizarHex(cor);
  if (!hex) return e;
  if (id === ID_FAVORITOS) return (e.favoritos ?? []).includes(hex) ? e : alternarFavorito(e, hex);
  return { ...e, grupos: e.grupos.map((g) => (g.id === id && !g.cores.includes(hex) && g.cores.length < MAX_CORES_GRUPO ? { ...g, cores: [...g.cores, hex] } : g)) };
}

export function removerCor(e: EstadoPaletas, id: string, cor: string): EstadoPaletas {
  if (id === ID_FAVORITOS) return { ...e, favoritos: (e.favoritos ?? []).filter((c) => c !== cor) };
  return { ...e, grupos: e.grupos.map((g) => (g.id === id ? { ...g, cores: g.cores.filter((c) => c !== cor) } : g)) };
}

/** Troca de lugar duas cores do grupo (arrastar uma amostra sobre outra). */
export function trocarCores(e: EstadoPaletas, id: string, i: number, j: number): EstadoPaletas {
  if (id === ID_FAVORITOS) {
    const f = [...(e.favoritos ?? [])];
    if (i === j || i < 0 || j < 0 || i >= f.length || j >= f.length) return e;
    [f[i], f[j]] = [f[j]!, f[i]!];
    return { ...e, favoritos: f };
  }
  return {
    ...e,
    grupos: e.grupos.map((g) => {
      if (g.id !== id || i === j || i < 0 || j < 0 || i >= g.cores.length || j >= g.cores.length) return g;
      const cores = [...g.cores];
      [cores[i], cores[j]] = [cores[j]!, cores[i]!];
      return { ...g, cores };
    }),
  };
}

export function escolherGrupo(e: EstadoPaletas, ferramenta: Ferramenta, id: string): EstadoPaletas {
  return { ...e, escolhido: { ...e.escolhido, [ferramenta]: id } };
}

export function lerEstado(bruto: string | null): EstadoPaletas {
  try {
    const j = JSON.parse(bruto ?? "null") as Partial<EstadoPaletas> | null;
    if (!j || !Array.isArray(j.grupos)) return VAZIO;
    const grupos = j.grupos
      .filter((g): g is GrupoCores => !!g && typeof g.id === "string" && typeof g.nome === "string" && Array.isArray(g.cores))
      .slice(0, MAX_GRUPOS_PROPRIOS)
      .map((g) => ({ id: g.id, nome: g.nome.slice(0, 24), proprio: true, cores: g.cores.map((c) => normalizarHex(String(c))).filter((c): c is string => !!c).slice(0, MAX_CORES_GRUPO) }));
    const favoritos = Array.isArray(j.favoritos) ? j.favoritos.map((c) => normalizarHex(String(c))).filter((c): c is string => !!c).slice(0, MAX_CORES_GRUPO) : undefined;
    return { grupos, ...(favoritos ? { favoritos } : {}), escolhido: j.escolhido && typeof j.escolhido === "object" ? j.escolhido : {}, ...(j.slots && typeof j.slots === "object" ? { slots: j.slots } : {}) };
  } catch { return VAZIO; }
}

// --- armazenamento compartilhado (o editor da janela e o do Foco enxergam o mesmo) -----------------

let atual: EstadoPaletas | null = null;
const ouvintes = new Set<() => void>();

function estadoAtual(): EstadoPaletas {
  if (atual) return atual;
  try { atual = lerEstado(localStorage.getItem(CHAVE)); } catch { atual = VAZIO; }
  return atual;
}

function gravar(novo: EstadoPaletas) {
  if (novo === atual) return;
  atual = novo;
  try { localStorage.setItem(CHAVE, JSON.stringify(novo)); } catch { /* sem armazenamento: vale só nesta sessão */ }
  ouvintes.forEach((o) => o());
}

const assinar = (o: () => void) => { ouvintes.add(o); return () => { ouvintes.delete(o); }; };

/** Só para testes: descarta o cache em memória. */
export function reiniciarPaletas() { atual = null; }

export function usePaletasTinta(ferramenta: Ferramenta) {
  const estado = useSyncExternalStore(assinar, estadoAtual, () => VAZIO);
  const prontos = gruposProntos(ferramenta);
  const favoritos = estado.favoritos ?? [];
  const grupos: GrupoCores[] = [...(favoritos.length ? [{ id: ID_FAVORITOS, nome: "Favoritos", cores: favoritos, proprio: false }] : []), ...prontos, ...estado.grupos];
  const grupo = grupos.find((g) => g.id === estado.escolhido[ferramenta]) ?? prontos[0]!;
  return {
    grupos,
    grupo,
    escolher: (id: string) => gravar(escolherGrupo(estadoAtual(), ferramenta, id)),
    /** Cria um grupo próprio (já escolhido) e devolve o id, ou `null` no limite de grupos. */
    criar: (nome?: string, cores?: string[]) => {
      const r = criarGrupo(estadoAtual(), nome, cores);
      if (r.id) gravar(escolherGrupo(r.estado, ferramenta, r.id));
      return r.id;
    },
    renomear: (id: string, nome: string) => gravar(renomearGrupo(estadoAtual(), id, nome)),
    excluir: (id: string) => gravar(excluirGrupo(estadoAtual(), id)),
    adicionar: (id: string, cor: string) => gravar(adicionarCor(estadoAtual(), id, cor)),
    remover: (id: string, cor: string) => gravar(removerCor(estadoAtual(), id, cor)),
    favoritos,
    alternarFavorito: (cor: string) => gravar(alternarFavorito(estadoAtual(), cor)),
    trocar: (id: string, i: number, j: number) => gravar(trocarCores(estadoAtual(), id, i, j)),
  };
}

/** Os três seletores de cor da ferramenta (compartilhados entre os editores abertos). */
export function useSlotsCor(ferramenta: Ferramenta) {
  const estado = useSyncExternalStore(assinar, estadoAtual, () => VAZIO);
  const { cores, ativo } = lerSlots(estado, ferramenta);
  return {
    cores,
    ativo,
    ativar: (i: number) => gravar(ativarSlot(estadoAtual(), ferramenta, i)),
    definir: (i: number, cor: string) => gravar(definirSlot(estadoAtual(), ferramenta, i, cor)),
  };
}
