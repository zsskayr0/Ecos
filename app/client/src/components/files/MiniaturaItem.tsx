import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { notas, tarefas, type Subtarefa } from "@/lib/api";
import { blocosDoResumo } from "@/lib/resumo-texto";
import type { PreferenciasAplicativo } from "@/lib/preferencias-aplicativo";

export type TamanhoMiniatura = Exclude<PreferenciasAplicativo["arquivosMiniatura"], "desligada">;

/** Largura mínima de cada coluna da grade, por tamanho da miniatura. */
export const LARGURA_MINIATURA: Record<TamanhoMiniatura, number> = { pequena: 132, media: 176, grande: 232 };

/** Largura (px) em que o texto é desenhado antes de reduzir à miniatura: a folha parece uma página inteira em escala. */
const LARGURA_FOLHA = 400;
/** Quanto do texto entra na miniatura: o resto ficaria fora da folha de qualquer jeito. */
const MAX_SUBTAREFAS = 8;

interface Previa { titulo: string; corpo: string; subtarefas: Subtarefa[] }

const cache = new Map<string, Previa>();
const emVoo = new Map<string, Promise<Previa>>();
let ativas = 0;
const fila: (() => void)[] = [];

/** No máximo 4 buscas ao mesmo tempo: uma pasta grande não deve disparar centenas de pedidos de uma vez. */
function naFila<T>(tarefa: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const rodar = () => {
      ativas++;
      tarefa().then(resolve, reject).finally(() => { ativas--; fila.shift()?.(); });
    };
    if (ativas < 4) rodar(); else fila.push(rodar);
  });
}

function buscar(tipo: "nota" | "tarefa", id: string, versao: string): Promise<Previa> {
  const chave = `${tipo}:${id}:${versao}`;
  const pronta = cache.get(chave);
  if (pronta) return Promise.resolve(pronta);
  const andando = emVoo.get(chave);
  if (andando) return andando;
  const p = naFila(async (): Promise<Previa> => {
    if (tipo === "nota") {
      const n = await notas.obter(id);
      return { titulo: n.titulo, corpo: n.corpo, subtarefas: [] };
    }
    const t = await tarefas.obter(id);
    return { titulo: t.titulo, corpo: t.corpo, subtarefas: t.subtarefas ?? [] };
  }).then((r) => { cache.set(chave, r); return r; }).finally(() => { emVoo.delete(chave); });
  emVoo.set(chave, p);
  return p;
}

/** Miniatura de nota ou tarefa: uma folha A4 com o começo do texto, desenhada em escala. Só busca o conteúdo quando entra na tela. */
export function MiniaturaItem({ tipo, id, versao, titulo }: { tipo: "nota" | "tarefa"; id: string; versao: string; titulo: string }) {
  const raiz = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(() => cache.get(`${tipo}:${id}:${versao}`) ?? null);
  const [falhou, setFalhou] = useState(false);
  const [escala, setEscala] = useState(0.3);

  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    setEscala(el.clientWidth / LARGURA_FOLHA || 0.3);
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => setEscala(el.clientWidth / LARGURA_FOLHA || 0.3));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = raiz.current;
    if (!el || visivel) return;
    if (typeof IntersectionObserver !== "function") { setVisivel(true); return; }
    const io = new IntersectionObserver((entradas) => { if (entradas.some((e) => e.isIntersecting)) { setVisivel(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visivel]);

  useEffect(() => {
    if (!visivel) return;
    let vivo = true;
    setFalhou(false);
    buscar(tipo, id, versao).then((p) => { if (vivo) setPrevia(p); }).catch(() => { if (vivo) setFalhou(true); });
    return () => { vivo = false; };
  }, [visivel, tipo, id, versao]);

  const vazia = previa && !previa.corpo.trim() && previa.subtarefas.length === 0;

  return (
    <div ref={raiz} aria-hidden data-testid="miniatura-item" className="relative aspect-[1/1.414] w-full overflow-hidden rounded-md border border-border bg-surface-2 shadow-sm">
      {previa && (
        <div className="pointer-events-none absolute left-0 top-0 select-none px-6 py-6" style={{ width: LARGURA_FOLHA, transform: `scale(${escala})`, transformOrigin: "top left" }}>
          <p className="mb-3 font-body text-[26px] font-semibold leading-tight text-text-primary [overflow-wrap:anywhere]">{previa.titulo || titulo || "Sem título"}</p>
          {previa.subtarefas.length > 0 && (
            <ul className="mb-3 flex flex-col gap-1.5">
              {previa.subtarefas.slice(0, MAX_SUBTAREFAS).map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-[18px] leading-snug">
                  <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border ${s.concluida ? "border-success bg-success/20 text-success" : "border-text-muted"}`}>{s.concluida && <Check size={13} strokeWidth={3} />}</span>
                  <span className={s.concluida ? "text-text-muted line-through" : "text-text-primary"}>{s.titulo}</span>
                </li>
              ))}
            </ul>
          )}
          {!vazia && previa.corpo.trim() && (
            <div lang="pt-BR" className="flex flex-col gap-2.5 text-[18px] leading-[1.4] text-text-secondary">
              {blocosDoResumo(previa.corpo, 520).map((b, i) => b.tipo === "titulo"
                ? <p key={i} className="mt-1 font-semibold text-text-primary [text-wrap:balance]">{b.texto}</p>
                : b.tipo === "item"
                  ? <p key={i} className="flex gap-2"><span aria-hidden>•</span><span className="min-w-0 flex-1 text-justify [hyphens:auto] [text-wrap:pretty]">{b.texto}</span></p>
                  : <p key={i} className="text-justify [hyphens:auto] [text-wrap:pretty]">{b.texto}</p>)}
            </div>
          )}
        </div>
      )}
      {!previa && (
        <p className={`absolute inset-x-0 top-0 line-clamp-3 px-2 pt-2 text-[10px] leading-tight text-text-muted ${falhou ? "" : "animate-pulse"}`}>{titulo}</p>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-surface-2 to-transparent" />
    </div>
  );
}
