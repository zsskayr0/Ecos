import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ListFilter } from "lucide-react";
import { useEscFecha } from "@/components/common/Dialog";
import "@/components/common/menu-suspenso.css";
import { BarraFiltros } from "@/components/views/filtros/BarraFiltros";
import { chaveDoDono, type EstadoFiltros, type ItemFiltravel } from "@/components/views/filtros/modelo";
import { canonicaTag } from "@/lib/tags";
import "./filtros-explorador.css";

const SAIDA_MS = 110;

interface Props {
  estado: EstadoFiltros;
  onChange: (estado: EstadoFiltros) => void;
  itens: ItemFiltravel[];
  pastas: { caminho: string; nome: string }[];
  visiveis: number;
  nFiltros: number;
}

export function FiltrosExplorador({ estado, onChange, itens, pastas, visiveis, nFiltros }: Props) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    if (aberto || !montado) return;
    const timer = window.setTimeout(() => setMontado(false), SAIDA_MS);
    return () => window.clearTimeout(timer);
  }, [aberto, montado]);

  useEscFecha(aberto, () => {
    setAberto(false);
    botao.current?.focus();
  });

  useLayoutEffect(() => {
    if (!aberto) return;
    const alinhar = () => {
      const gatilho = botao.current?.getBoundingClientRect();
      const popup = painel.current;
      if (!gatilho || !popup) return;
      const larguraJanela = document.documentElement.clientWidth || window.innerWidth;
      const larguraPopup = popup.offsetWidth;
      const centro = gatilho.left + (gatilho.width - larguraPopup) / 2;
      const esquerda = Math.max(8, Math.min(centro, larguraJanela - larguraPopup - 8));
      popup.style.left = `${esquerda - gatilho.left}px`;
    };
    alinhar();
    window.addEventListener("resize", alinhar);
    return () => window.removeEventListener("resize", alinhar);
  }, [aberto, nFiltros]);

  useEffect(() => {
    if (!aberto) return;
    painel.current?.querySelector("button")?.focus({ preventScroll: true });
    const aoClicarFora = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("pointerdown", aoClicarFora);
    return () => document.removeEventListener("pointerdown", aoClicarFora);
  }, [aberto]);

  const tags = new Set<string>();
  const donos = new Map<string, string>();
  for (const item of itens) {
    for (const tag of item.tags ?? []) tags.add(canonicaTag(tag) ?? tag);
    if (item.dono) donos.set(chaveDoDono({ dono: item.dono }), item.dono.nome);
  }

  return (
    <div ref={raiz} className="relative shrink-0"
      onBlur={(e) => { if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setAberto(false); }}>
      <button ref={botao} type="button" aria-label="Filtros" aria-haspopup="dialog" aria-expanded={aberto} aria-controls={aberto ? id : undefined}
        onClick={() => {
          if (!aberto) setMontado(true);
          setAberto(!aberto);
        }}
        className={`flex h-9 w-9 items-center justify-center rounded-xl border hover:bg-surface-2 hover:text-text-primary ${aberto || nFiltros ? "border-steel-400 bg-surface-2 text-text-primary" : "border-border bg-surface-1 text-text-secondary"}`}>
        <ListFilter size={15} aria-hidden />
      </button>
      {montado && (
        <div ref={painel} id={id} role="dialog" aria-label="Filtros desta pasta" aria-hidden={!aberto}
          data-saindo={!aberto} data-alinhar="centro" {...(!aberto ? { inert: "" } : {})}
          onClickCapture={(e) => {
            if (!(e.target instanceof Element) || !e.target.closest("[data-gatilho]")) return;
            // O submenu fixo mede sua posição com o painel já na posição final.
            e.currentTarget.getAnimations?.().forEach((animacao) => animacao.finish());
          }}
          className="ecos-menu ecos-filtros-explorador absolute z-40 w-56 max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-surface-1 p-2 shadow-nav">
          <BarraFiltros noExplorador estado={estado} onChange={onChange} temTarefas={itens.some((item) => item.tipo === "tarefa")}
            visiveis={visiveis} total={itens.length} contexto={{
              equipes: [],
              pastas,
              tags: [...tags].sort((a, b) => a.localeCompare(b, "pt-BR")),
              donos: [...donos].map(([valor, nome]) => ({ valor, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
            }} />
        </div>
      )}
    </div>
  );
}
