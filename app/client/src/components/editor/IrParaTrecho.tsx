import { useEffect, useRef, useState, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { aoPedirIr, consumirPedido, linhaDoAlvo, normalizarTrecho, type AlvoIr } from "@/lib/ir-para";
import { rolarAteElemento, rolarAteLinha } from "./sumario-editor";
import "./ir-para.css";

interface Props {
  itemId: string | undefined;
  corpo: string;
  /** Editor vivo, quando a nota está em edição; null na leitura. */
  view: EditorView | null;
  raiz: RefObject<HTMLElement | null>;
}

const MARGEM = 140;
/** A rolagem dura 0,5 s; o brilho começa quando ela chega. */
const ATRASO_DESTAQUE = 520;

function elementoDaLinha(view: EditorView, linha: number): HTMLElement | null {
  if (linha > view.state.doc.lines) return null;
  const no = view.domAtPos(view.state.doc.line(linha).from).node;
  const el = no.nodeType === Node.TEXT_NODE ? no.parentElement : (no as HTMLElement);
  return el?.closest<HTMLElement>(".cm-line") ?? null;
}

function elementoNaLeitura(raiz: HTMLElement | null, alvo: AlvoIr): HTMLElement | null {
  if (!raiz) return null;
  if ("url" in alvo) return Array.from(raiz.querySelectorAll<HTMLAnchorElement>("a[href]")).find((a) => a.getAttribute("href") === alvo.url || a.href === alvo.url) ?? null;
  const titulo = normalizarTrecho(alvo.wikilink);
  return Array.from(raiz.querySelectorAll<HTMLElement>("[data-wikilink]")).find((e) => normalizarTrecho(e.dataset.wikilink ?? "") === titulo) ?? null;
}

function destacar(el: HTMLElement) {
  const bloco = el.closest<HTMLElement>("li,p,h1,h2,h3,h4,h5,h6,td,blockquote,.cm-line") ?? el;
  bloco.classList.remove("ecos-ir-destaque");
  void bloco.offsetWidth; // reinicia a animação se já estava destacado
  bloco.classList.add("ecos-ir-destaque");
  window.setTimeout(() => bloco.classList.remove("ecos-ir-destaque"), 2600);
}

/**
 * Atende o "ver onde está" do mapa de conexões: rola, com a mesma animação do sumário, até o link externo ou o
 * `[[wikilink]]` pedido e o destaca por um instante. Funciona na edição (pela linha do documento) e na leitura (pelo DOM).
 */
export function IrParaTrecho({ itemId, corpo, view, raiz }: Props) {
  const pendente = useRef<AlvoIr | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [pedido, setPedido] = useState(0);

  useEffect(() => {
    if (!itemId) return;
    const pegar = () => {
      const alvo = consumirPedido(itemId);
      if (alvo) { pendente.current = alvo; setPedido((n) => n + 1); }
    };
    pegar();
    return aoPedirIr(itemId, pegar);
  }, [itemId]);

  useEffect(() => {
    const alvo = pendente.current;
    if (!alvo || !corpo) return; // corpo ainda não chegou: roda de novo quando chegar
    const linha = linhaDoAlvo(corpo, alvo);
    if (linha === null) { pendente.current = null; return; } // o trecho não está (mais) no texto
    let tentativas = 0;
    let t = 0;
    const tentar = () => {
      const v = viewRef.current;
      if (v && linha <= v.state.doc.lines) {
        pendente.current = null;
        rolarAteLinha(v, linha, MARGEM);
        t = window.setTimeout(() => { const el = elementoDaLinha(v, linha); if (el) destacar(el); }, ATRASO_DESTAQUE);
        return;
      }
      const el = v ? null : elementoNaLeitura(raiz.current, alvo);
      if (el) {
        pendente.current = null;
        rolarAteElemento(el, MARGEM);
        t = window.setTimeout(() => destacar(el), ATRASO_DESTAQUE);
        return;
      }
      if (++tentativas < 25) t = window.setTimeout(tentar, 120); // a janela ainda está montando o texto
    };
    t = window.setTimeout(tentar, 200);
    return () => window.clearTimeout(t);
  }, [pedido, corpo, view, raiz]);

  return null;
}
