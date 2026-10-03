import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { GripVertical } from "lucide-react";

/**
 * Ordem escolhida pela pessoa para uma lista (contas, categorias). O servidor devolve a lista já na ordem dela; aqui
 * o arrasto reordena na hora (sem esperar a rede) e `persistir` guarda. Se guardar falhar, volta à ordem do servidor.
 * A mesma reordenação existe no teclado: seta para cima/baixo na alça.
 */
export function useOrdemPessoal<T extends { id: string }>(itens: T[], persistir: (ids: string[]) => Promise<unknown>, aoFalhar?: () => void) {
  const [local, setLocal] = useState<string[] | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<{ id: string; depois: boolean } | null>(null);
  const [recemMovido, setRecemMovido] = useState<string | null>(null);
  const persistirRef = useRef(persistir);
  persistirRef.current = persistir;

  // A lista nova do servidor já traz a ordem guardada: a local cumpriu seu papel.
  useEffect(() => setLocal(null), [itens]);

  const ordenados = useMemo(() => {
    if (!local) return itens;
    const porId = new Map(itens.map((i) => [i.id, i]));
    const naOrdem = local.flatMap((id) => (porId.has(id) ? [porId.get(id)!] : []));
    const fora = itens.filter((i) => !local.includes(i.id));
    return [...naOrdem, ...fora];
  }, [itens, local]);

  function aplicar(ids: string[], movido: string) {
    setLocal(ids);
    setRecemMovido(movido);
    window.setTimeout(() => setRecemMovido((atual) => (atual === movido ? null : atual)), 900);
    persistirRef.current(ids).catch(() => { setLocal(null); aoFalhar?.(); });
  }

  function moverPara(id: string, alvoId: string, depois: boolean) {
    if (id === alvoId) return;
    const ids = ordenados.map((i) => i.id).filter((x) => x !== id);
    const posicao = ids.indexOf(alvoId);
    if (posicao < 0) return;
    ids.splice(depois ? posicao + 1 : posicao, 0, id);
    aplicar(ids, id);
  }

  function deslocar(id: string, delta: -1 | 1) {
    const ids = ordenados.map((i) => i.id);
    const de = ids.indexOf(id);
    const para = de + delta;
    if (de < 0 || para < 0 || para >= ids.length) return;
    [ids[de], ids[para]] = [ids[para]!, ids[de]!];
    aplicar(ids, id);
  }

  function encerrar() {
    setArrastando(null);
    setAlvo(null);
  }

  return {
    ordenados,
    arrastando,
    /** Props da linha que recebe o arrasto. */
    linha: (id: string) => ({
      "data-arrastando": arrastando === id || undefined,
      "data-solto": recemMovido === id || undefined,
      "data-alvo": alvo?.id === id && arrastando && arrastando !== id ? (alvo.depois ? "depois" : "antes") : undefined,
      onDragOver: (e: DragEvent) => {
        if (!arrastando) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const depois = e.clientY > r.top + r.height / 2;
        setAlvo((a) => (a?.id === id && a.depois === depois ? a : { id, depois }));
      },
      onDrop: (e: DragEvent) => {
        if (!arrastando) return;
        e.preventDefault();
        e.stopPropagation();
        const depois = alvo?.id === id ? alvo.depois : false;
        moverPara(arrastando, id, depois);
        encerrar();
      },
    }),
    /** Props da alça de arrastar (também reordena com as setas). */
    alca: (id: string) => ({
      draggable: true,
      onDragStart: (e: DragEvent) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        const linha = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-ordem-linha]");
        if (linha) e.dataTransfer.setDragImage(linha, 24, 20);
        setArrastando(id);
      },
      onDragEnd: encerrar,
      onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        e.stopPropagation();
        deslocar(id, e.key === "ArrowUp" ? -1 : 1);
        const botao = e.currentTarget as HTMLElement;
        window.requestAnimationFrame(() => botao.focus());
      },
    }),
  };
}

/** Alça de reordenar. `desativada` (lista filtrada ou com busca) esconde a alça: reordenar só faz sentido com a lista inteira. */
export function AlcaOrdem({ nome, desativada, ...props }: { nome: string; desativada?: boolean } & Record<string, unknown>) {
  if (desativada) return null;
  return (
    <span
      role="button"
      tabIndex={0}
      className="cofre-ordem-alca"
      aria-label={`Reordenar ${nome}. Arraste, ou use as setas para cima e para baixo.`}
      title="Arraste para reordenar"
      {...props}
    >
      <GripVertical size={14} aria-hidden />
    </span>
  );
}
