import { useEffect, useMemo, useRef, useState } from "react";
import { fonteBlocos, linhaBloco } from "./blocos-barra";
import { autocompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { normalizarTexto } from "@/lib/texto-busca";

type Emoji = [emoji: string, nomes: string];
interface Categoria { id: string; rotulo: string; icone: string; itens: Emoji[] }

/** Catálogo enxuto, nomes em pt-BR separados por vírgula (o 1º é o nome do `:atalho:`). */
export const CATEGORIAS_EMOJI: Categoria[] = [
  { id: "rostos", rotulo: "Rostos", icone: "😀", itens: [
    ["😀", "sorriso,feliz"], ["😄", "rindo,alegre"], ["😁", "sorrisao,dentes"], ["😂", "chorando_de_rir,risada"], ["🤣", "rolando_de_rir"], ["😊", "contente,corado"],
    ["😉", "piscadinha,piscando"], ["😍", "apaixonado,olhos_de_coracao"], ["🥰", "amor,carinho"], ["😘", "beijo"], ["😎", "oculos_escuros,legal"], ["🤩", "deslumbrado,estrelas"],
    ["🤔", "pensando,duvida"], ["🤨", "desconfiado"], ["😐", "neutro,serio"], ["🙄", "revirando_olhos"], ["😴", "dormindo,sono"], ["😅", "suando,ufa,alivio"],
    ["😬", "careta,tenso"], ["😢", "triste,lagrima"], ["😭", "chorando,choro"], ["😡", "bravo,raiva"], ["🤯", "explodindo,mente"], ["😱", "grito,susto,medo"],
    ["🥳", "festa,comemorando"], ["🤗", "abraco"], ["🤫", "silencio,shh"], ["🤒", "doente,febre"], ["🙃", "de_cabeca_pra_baixo,ironia"], ["😇", "anjo,inocente"],
  ] },
  { id: "gestos", rotulo: "Gestos", icone: "👍", itens: [
    ["👍", "joinha,positivo,ok"], ["👎", "negativo"], ["👏", "palmas,aplausos"], ["🙌", "maos_pro_alto,viva"], ["🙏", "por_favor,obrigado,reza"], ["💪", "forca,musculo"],
    ["👋", "tchau,ola,aceno"], ["🤝", "aperto_de_mao,acordo"], ["✌️", "paz,vitoria"], ["🤞", "dedos_cruzados,sorte"], ["👌", "perfeito"], ["👉", "apontando,direita"],
    ["👀", "olhos,olhando"], ["🧠", "cerebro,ideia"], ["✍️", "escrevendo"],
  ] },
  { id: "simbolos", rotulo: "Símbolos", icone: "✅", itens: [
    ["✅", "feito,concluido,check"], ["☑️", "caixa_marcada"], ["❌", "erro,nao,x"], ["⚠️", "atencao,aviso"], ["❗", "exclamacao,importante"], ["❓", "pergunta,interrogacao"],
    ["⭐", "estrela,favorito"], ["✨", "brilho,novo"], ["🔥", "fogo,urgente"], ["💡", "lampada,ideia"], ["❤️", "coracao,amor"], ["💔", "coracao_partido"],
    ["💯", "cem,nota_maxima"], ["🔴", "vermelho,bola_vermelha"], ["🟡", "amarelo"], ["🟢", "verde"], ["🔵", "azul"], ["➡️", "seta_direita"],
    ["⬅️", "seta_esquerda"], ["🔁", "repetir,recorrente"], ["🚫", "proibido,bloqueado"], ["♻️", "reciclar"],
  ] },
  { id: "objetos", rotulo: "Objetos", icone: "📌", itens: [
    ["📌", "alfinete,fixar"], ["📎", "clipe,anexo"], ["📅", "calendario,data"], ["⏰", "despertador,alarme,prazo"], ["⏳", "ampulheta,aguardando"], ["📝", "nota,anotacao"],
    ["📚", "livros,estudo"], ["📖", "livro,leitura"], ["💰", "dinheiro,saco_de_dinheiro"], ["💳", "cartao"], ["🧾", "recibo,nota_fiscal"], ["📈", "grafico_subindo,alta"],
    ["📉", "grafico_descendo,queda"], ["📊", "grafico,barras"], ["🔒", "cadeado,trancado"], ["🔑", "chave"], ["📧", "email"], ["📞", "telefone"],
    ["💻", "computador,notebook"], ["📱", "celular"], ["🛒", "carrinho,compras"], ["🎁", "presente"], ["🏠", "casa,lar"], ["🔧", "ferramenta,chave_inglesa"],
  ] },
  { id: "atividades", rotulo: "Atividades", icone: "🎉", itens: [
    ["🎉", "comemoracao,confete"], ["🎯", "alvo,meta,objetivo"], ["🚀", "foguete,lancamento"], ["🏆", "trofeu,conquista"], ["🎂", "bolo,aniversario"], ["🏃", "correndo,corrida"],
    ["🏋️", "academia,musculacao"], ["⚽", "futebol,bola"], ["🎵", "musica,nota_musical"], ["🎮", "videogame,jogo"], ["✈️", "aviao,viagem"], ["🚗", "carro"],
  ] },
  { id: "natureza", rotulo: "Natureza e comida", icone: "🌱", itens: [
    ["🌱", "broto,planta"], ["🌳", "arvore"], ["🌸", "flor"], ["☀️", "sol"], ["🌧️", "chuva"], ["❄️", "neve,frio"], ["🌙", "lua,noite"], ["🐶", "cachorro"],
    ["🐱", "gato"], ["☕", "cafe"], ["🍕", "pizza"], ["🍎", "maca,fruta"], ["🍺", "cerveja"], ["🥗", "salada"],
  ] },
];

const TODOS: Emoji[] = CATEGORIAS_EMOJI.flatMap((c) => c.itens);
const CHAVE_RECENTES = "ecos.emoji.recentes";
const MAX_RECENTES = 18;

function lerRecentes(): string[] {
  try { const v = JSON.parse(localStorage.getItem(CHAVE_RECENTES) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, MAX_RECENTES) : []; } catch { return []; }
}
export function registrarRecente(emoji: string) {
  try { localStorage.setItem(CHAVE_RECENTES, JSON.stringify([emoji, ...lerRecentes().filter((e) => e !== emoji)].slice(0, MAX_RECENTES))); } catch { /* sem armazenamento */ }
}

/** Busca por nome em pt-BR, sem acento e sem diferenciar maiúsculas. Prefixo do nome vem antes de "contém". */
export function buscarEmojis(consulta: string, limite = 60): Emoji[] {
  const q = normalizarTexto(consulta).replace(/[\s:]+/g, "_").replace(/^_|_$/g, "");
  if (!q) return [];
  const pontos = TODOS.map((e) => {
    const nomes = e[1].split(",");
    const p = nomes.some((n) => n.startsWith(q)) ? 0 : nomes.some((n) => n.includes(q)) ? 1 : -1;
    return [e, p] as const;
  }).filter(([, p]) => p >= 0);
  return pontos.sort((a, b) => a[1] - b[1]).slice(0, limite).map(([e]) => e);
}

function nomeDe(e: Emoji) { return e[1].split(",")[0]; }

/** Mesma API do seletor antigo do CorpoEditor: aoEscolher(emoji), aoFechar(), alinharDireita. */
export function SeletorEmoji({ aoEscolher, aoFechar, alinharDireita }: { aoEscolher: (emoji: string) => void; aoFechar: () => void; alinharDireita: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const busca = useRef<HTMLInputElement>(null);
  const [consulta, setConsulta] = useState("");
  const [recentes] = useState(lerRecentes);
  const [aba, setAba] = useState(() => (lerRecentes().length ? "recentes" : CATEGORIAS_EMOJI[0].id));

  useEffect(() => {
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) aoFechar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") aoFechar(); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    busca.current?.focus();
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aoFechar]);

  const lista: Emoji[] = useMemo(() => {
    if (consulta.trim()) return buscarEmojis(consulta);
    if (aba === "recentes") return recentes.map((r) => TODOS.find((e) => e[0] === r) ?? [r, ""] as Emoji);
    return CATEGORIAS_EMOJI.find((c) => c.id === aba)?.itens ?? [];
  }, [consulta, aba, recentes]);

  const escolher = (emoji: string) => { registrarRecente(emoji); aoEscolher(emoji); };
  const abas = [...(recentes.length ? [{ id: "recentes", rotulo: "Recentes", icone: "🕘" }] : []), ...CATEGORIAS_EMOJI];

  return (
    <div ref={ref} role="dialog" aria-label="Escolher emoji" className={`absolute top-full z-40 mt-1 w-72 rounded-xl border border-border bg-surface-2 p-1.5 shadow-nav ecos-fade-in ${alinharDireita ? "right-0" : "left-0"}`}>
      <input
        ref={busca}
        type="search"
        value={consulta}
        onChange={(e) => setConsulta(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && lista[0]) { e.preventDefault(); escolher(lista[0][0]); } }}
        placeholder="Buscar emoji…"
        aria-label="Buscar emoji"
        className="mb-1.5 w-full rounded-md border border-border bg-surface-1 px-2 py-1 text-sm text-text-primary outline-none focus:border-steel-400"
      />
      {!consulta.trim() && (
        <div role="tablist" aria-label="Categorias de emoji" className="mb-1 flex gap-0.5 border-b border-border pb-1">
          {abas.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={aba === c.id} title={c.rotulo} aria-label={c.rotulo} onClick={() => setAba(c.id)}
              className={`flex h-7 w-7 items-center justify-center rounded-md text-base hover:bg-surface-3 ${aba === c.id ? "bg-surface-3" : ""}`}>{c.icone}</button>
          ))}
        </div>
      )}
      <div className="grid max-h-56 grid-cols-9 gap-0.5 overflow-y-auto">
        {lista.map(([emoji, nomes]) => (
          <button key={emoji} type="button" title={nomes ? `:${nomeDe([emoji, nomes])}:` : undefined} aria-label={nomes ? nomeDe([emoji, nomes]).replace(/_/g, " ") : emoji}
            onClick={() => escolher(emoji)} className="flex h-7 w-7 items-center justify-center rounded-md text-base hover:bg-surface-3">{emoji}</button>
        ))}
      </div>
      {lista.length === 0 && <p className="px-1 py-2 text-xs text-text-muted">Nenhum emoji encontrado.</p>}
    </div>
  );
}

/** Fonte de autocompletar para `:nome` (2+ letras depois dos dois-pontos). Aplicar troca `:nome` pelo emoji. */
export const fonteEmoji: CompletionSource = (ctx: CompletionContext): CompletionResult | null => {
  const m = ctx.matchBefore(/(?:^|[\s(])(:[\p{L}_]{2,})$/u);
  if (!m) return null;
  const ini = m.to - m.text.replace(/^[\s(]/, "").length;
  const termo = ctx.state.sliceDoc(ini + 1, m.to);
  const achados = buscarEmojis(termo, 20);
  if (!achados.length) return null;
  return {
    from: ini,
    filter: false,
    options: achados.map((e): Completion => ({
      label: `${e[0]}  :${nomeDe(e)}:`,
      type: "emoji",
      apply: (view, _c, from, to) => {
        registrarRecente(e[0]);
        const depois = view.state.sliceDoc(to, to + 1) === ":" ? to + 1 : to;
        view.dispatch({ changes: { from, to: depois, insert: e[0] }, selection: { anchor: from + e[0].length }, userEvent: "input.complete" });
      },
    })),
  };
};

/** Extensão própria — use só quando o editor NÃO tiver o autocompletar de wikilink (ver doc de integração). */
export function autocompletarEmoji(): Extension {
  return autocompletion({ override: [fonteEmoji, fonteBlocos], icons: false, addToOptions: [{ render: (c) => (c.type === "bloco" ? linhaBloco(c) : null), position: 10 }], activateOnTyping: true });
}
