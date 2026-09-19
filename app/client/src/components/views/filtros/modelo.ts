import type { FeedItem } from "@/lib/types";

/** Filtros e ordenação no estilo do Notion: cada condição é (propriedade, operador, valor); várias condições combinam por "todas" (E) ou "qualquer" (OU). */

export type TipoPropriedade = "texto" | "selecao" | "multi" | "data" | "numero";

export type Operador =
  | "e" | "nao_e" | "contem" | "nao_contem" | "comeca" | "termina" | "vazio" | "nao_vazio"
  | "antes" | "depois" | "ultimos" | "igual" | "maior" | "menor";

export interface Opcao { valor: string; rotulo: string }

export interface Contexto {
  pastas: { caminho: string; nome: string }[];
  equipes: { id: string; nome: string }[];
  tags: string[];
}

export interface Propriedade {
  id: string;
  nome: string;
  tipo: TipoPropriedade;
  /** Valor bruto do item para esta propriedade (`null`/vazio = sem valor). */
  ler: (item: FeedItem) => string | string[] | number | null;
  opcoes?: (ctx: Contexto) => Opcao[];
}

const PRIORIDADE_ORDEM: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
const ROTULO_PRIORIDADE: Record<string, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

const pastaDe = (item: FeedItem) => (item.tipo === "nota" ? item.pastaId : item.pasta ?? null);

export const PROPRIEDADES: Propriedade[] = [
  { id: "titulo", nome: "Título", tipo: "texto", ler: (i) => i.titulo },
  { id: "conteudo", nome: "Conteúdo", tipo: "texto", ler: (i) => (i.tipo === "nota" ? i.corpo ?? i.preview : null) },
  {
    id: "status", nome: "Status", tipo: "selecao", ler: (i) => (i.tipo === "tarefa" ? i.status : null),
    opcoes: () => [{ valor: "pendente", rotulo: "Pendente" }, { valor: "concluida", rotulo: "Concluída" }],
  },
  {
    id: "prioridade", nome: "Prioridade", tipo: "selecao", ler: (i) => (i.tipo === "tarefa" ? i.prioridade : null),
    opcoes: () => [{ valor: "alta", rotulo: "Alta" }, { valor: "media", rotulo: "Média" }, { valor: "baixa", rotulo: "Baixa" }],
  },
  {
    id: "equipe", nome: "Equipe", tipo: "selecao", ler: (i) => i.espaco,
    opcoes: (ctx) => [{ valor: "pessoal", rotulo: "Pessoal" }, ...ctx.equipes.map((e) => ({ valor: `equipe:${e.id}`, rotulo: e.nome }))],
  },
  {
    id: "pasta", nome: "Pasta", tipo: "selecao", ler: (i) => pastaDe(i),
    opcoes: (ctx) => ctx.pastas.map((p) => ({ valor: p.caminho, rotulo: p.caminho.includes("/") ? p.caminho.replace(/\//g, " / ") : p.nome })),
  },
  { id: "dono", nome: "Dono", tipo: "texto", ler: (i) => i.dono?.nome ?? null },
  { id: "tags", nome: "Tags", tipo: "multi", ler: (i) => (i.tipo === "nota" ? i.tags : i.tags ?? []) },
  { id: "agendada", nome: "Agendada para", tipo: "data", ler: (i) => (i.tipo === "tarefa" ? i.scheduledAt ?? i.dueDate : null) },
  { id: "editada", nome: "Editada em", tipo: "data", ler: (i) => i.atualizadoEm ?? null },
  { id: "criada", nome: "Criada em", tipo: "data", ler: (i) => i.criadoEm ?? null },
  { id: "revisada", nome: "Revisada em", tipo: "data", ler: (i) => (i.tipo === "nota" ? i.ultimaRevisaoEm : null) },
  { id: "duracao", nome: "Duração (min)", tipo: "numero", ler: (i) => (i.tipo === "tarefa" ? i.durationMin : null) },
];

export const propriedadePorId = (id: string) => PROPRIEDADES.find((p) => p.id === id);

export const OPERADORES: Record<TipoPropriedade, { op: Operador; rotulo: string }[]> = {
  texto: [
    { op: "contem", rotulo: "contém" }, { op: "nao_contem", rotulo: "não contém" }, { op: "e", rotulo: "é" }, { op: "nao_e", rotulo: "não é" },
    { op: "comeca", rotulo: "começa com" }, { op: "termina", rotulo: "termina com" }, { op: "vazio", rotulo: "está vazio" }, { op: "nao_vazio", rotulo: "não está vazio" },
  ],
  selecao: [{ op: "e", rotulo: "é" }, { op: "nao_e", rotulo: "não é" }, { op: "vazio", rotulo: "está vazio" }, { op: "nao_vazio", rotulo: "não está vazio" }],
  multi: [{ op: "contem", rotulo: "contém" }, { op: "nao_contem", rotulo: "não contém" }, { op: "vazio", rotulo: "está vazio" }, { op: "nao_vazio", rotulo: "não está vazio" }],
  data: [
    { op: "e", rotulo: "é" }, { op: "antes", rotulo: "antes de" }, { op: "depois", rotulo: "depois de" }, { op: "ultimos", rotulo: "nos últimos (dias)" },
    { op: "vazio", rotulo: "está vazio" }, { op: "nao_vazio", rotulo: "não está vazio" },
  ],
  numero: [{ op: "igual", rotulo: "=" }, { op: "maior", rotulo: ">" }, { op: "menor", rotulo: "<" }, { op: "vazio", rotulo: "está vazio" }, { op: "nao_vazio", rotulo: "não está vazio" }],
};

export const semValor = (op: Operador) => op === "vazio" || op === "nao_vazio";

export interface Filtro { id: string; prop: string; op: Operador; valor: string }
export interface Ordenacao { prop: string; dir: "asc" | "desc" }
export interface EstadoFiltros { filtros: Filtro[]; juncao: "e" | "ou"; ordens: Ordenacao[] }

export const ESTADO_VAZIO: EstadoFiltros = { filtros: [], juncao: "e", ordens: [] };

let contador = 0;
export function novoFiltro(prop: string): Filtro {
  const p = propriedadePorId(prop)!;
  return { id: `f${Date.now().toString(36)}${contador++}`, prop, op: OPERADORES[p.tipo][0].op, valor: "" };
}

/** Dia local (AAAA-MM-DD) de uma data ISO; datas só com dia (prazo) passam direto. */
function diaLocal(valor: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const vazio = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** Um filtro sem valor ainda (digitando) não exclui nada. */
export const filtroCompleto = (f: Filtro) => semValor(f.op) || f.valor.trim() !== "";

export function combina(item: FeedItem, f: Filtro): boolean {
  const prop = propriedadePorId(f.prop);
  if (!prop) return true;
  const bruto = prop.ler(item);
  if (f.op === "vazio") return vazio(bruto);
  if (f.op === "nao_vazio") return !vazio(bruto);

  const alvo = f.valor.trim();
  switch (prop.tipo) {
    case "texto": {
      const texto = norm(String(bruto ?? "")); const busca = norm(alvo);
      if (f.op === "e") return texto === busca;
      if (f.op === "nao_e") return texto !== busca;
      if (f.op === "contem") return texto.includes(busca);
      if (f.op === "nao_contem") return !texto.includes(busca);
      if (f.op === "comeca") return texto.startsWith(busca);
      if (f.op === "termina") return texto.endsWith(busca);
      return true;
    }
    case "selecao":
      return f.op === "e" ? bruto === alvo : f.op === "nao_e" ? bruto !== alvo : true;
    case "multi": {
      const tem = (bruto as string[] | null ?? []).some((t) => norm(t.replace(/^#/, "")) === norm(alvo.replace(/^#/, "")));
      return f.op === "contem" ? tem : f.op === "nao_contem" ? !tem : true;
    }
    case "data": {
      if (vazio(bruto)) return false;
      const dia = diaLocal(String(bruto));
      if (!dia) return false;
      if (f.op === "e") return dia === alvo;
      if (f.op === "antes") return dia < alvo;
      if (f.op === "depois") return dia > alvo;
      if (f.op === "ultimos") {
        const dias = Number(alvo);
        if (!Number.isFinite(dias)) return true;
        const limite = new Date(); limite.setHours(0, 0, 0, 0); limite.setDate(limite.getDate() - dias);
        return dia >= `${limite.getFullYear()}-${String(limite.getMonth() + 1).padStart(2, "0")}-${String(limite.getDate()).padStart(2, "0")}`;
      }
      return true;
    }
    case "numero": {
      if (vazio(bruto)) return false;
      const n = Number(bruto); const a = Number(alvo);
      if (!Number.isFinite(a)) return true;
      return f.op === "igual" ? n === a : f.op === "maior" ? n > a : f.op === "menor" ? n < a : true;
    }
  }
}

export function filtrar(itens: FeedItem[], estado: EstadoFiltros): FeedItem[] {
  const ativos = estado.filtros.filter(filtroCompleto);
  if (!ativos.length) return itens;
  return itens.filter((item) => (estado.juncao === "e" ? ativos.every((f) => combina(item, f)) : ativos.some((f) => combina(item, f))));
}

function chaveOrdem(item: FeedItem, prop: Propriedade): string | number | null {
  const v = prop.ler(item);
  if (vazio(v)) return null;
  if (prop.id === "prioridade") return PRIORIDADE_ORDEM[String(v)] ?? 9;
  if (prop.tipo === "data") return new Date(String(v)).getTime() || null;
  if (prop.tipo === "numero") return Number(v);
  if (prop.tipo === "multi") return norm((v as string[]).join(" "));
  return norm(String(v));
}

export function ordenar(itens: FeedItem[], ordens: Ordenacao[]): FeedItem[] {
  const validas = ordens.map((o) => ({ ...o, prop: propriedadePorId(o.prop) })).filter((o): o is { prop: Propriedade; dir: "asc" | "desc" } => Boolean(o.prop));
  if (!validas.length) return itens;
  return itens
    .map((item, indice) => ({ item, indice }))
    .sort((a, b) => {
      for (const { prop, dir } of validas) {
        const ka = chaveOrdem(a.item, prop); const kb = chaveOrdem(b.item, prop);
        if (ka === kb) continue;
        if (ka === null) return 1; // sem valor sempre no fim, em qualquer direção
        if (kb === null) return -1;
        const cmp = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb), "pt-BR");
        if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
      }
      return a.indice - b.indice;
    })
    .map((x) => x.item);
}

export const ROTULO_DIRECAO: Record<TipoPropriedade, [string, string]> = {
  texto: ["A → Z", "Z → A"], selecao: ["A → Z", "Z → A"], multi: ["A → Z", "Z → A"],
  data: ["Mais antigo primeiro", "Mais novo primeiro"], numero: ["Menor primeiro", "Maior primeiro"],
};

export function rotuloDirecao(prop: Propriedade, dir: "asc" | "desc"): string {
  if (prop.id === "prioridade") return dir === "asc" ? "Alta primeiro" : "Baixa primeiro";
  return ROTULO_DIRECAO[prop.tipo][dir === "asc" ? 0 : 1];
}

export function rotuloValor(f: Filtro, ctx: Contexto): string {
  const prop = propriedadePorId(f.prop);
  if (!prop || semValor(f.op)) return "";
  if (prop.tipo === "selecao") return prop.opcoes?.(ctx).find((o) => o.valor === f.valor)?.rotulo ?? ROTULO_PRIORIDADE[f.valor] ?? f.valor;
  if (prop.tipo === "data" && /^\d{4}-\d{2}-\d{2}$/.test(f.valor)) return f.valor.split("-").reverse().join("/");
  return f.valor;
}

export const resumoFiltro = (f: Filtro, ctx: Contexto): string => {
  const prop = propriedadePorId(f.prop);
  if (!prop) return "";
  const op = OPERADORES[prop.tipo].find((o) => o.op === f.op)?.rotulo ?? "";
  return [prop.nome, op, rotuloValor(f, ctx)].filter(Boolean).join(" ");
};
