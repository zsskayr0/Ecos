import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ListChecks, Plus, StickyNote, Wallet } from "lucide-react";
import { useAppUI, type TipoCaptura } from "@/lib/ui-context";

const ITENS: { tipo: TipoCaptura; rotulo: string; Icone: typeof StickyNote }[] = [
  { tipo: "nota", rotulo: "Nota", Icone: StickyNote },
  { tipo: "tarefa", rotulo: "Tarefa", Icone: ListChecks },
  { tipo: "transacao", rotulo: "Transação", Icone: Wallet },
];

/** Botão "Criar" do desktop: abre um menu junto ao próprio botão (o popup central de escolha é coisa do mobile). */
export function MenuCriar() {
  const { abrirCaptura, diaCofre } = useAppUI();
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    raiz.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const fora = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  function aoTeclarNoMenu(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      setAberto(false);
      raiz.current?.querySelector<HTMLElement>("button")?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const itens = Array.from(raiz.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const atual = itens.indexOf(document.activeElement as HTMLElement);
    const proximo = (atual + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens[proximo]?.focus();
  }

  return (
    <div ref={raiz} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className="group flex h-8 items-center gap-1.5 rounded-lg pl-3 pr-2.5 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel-400"
        style={{ background: "linear-gradient(135deg, #278fb9 0%, #4b72d8 100%)", boxShadow: "0 1px 2px rgba(45, 91, 195, 0.24)" }}
      >
        <Plus size={15} strokeWidth={2} className="transition-transform duration-300 ease-out group-hover:rotate-[135deg] group-hover:scale-110 motion-reduce:transform-none motion-reduce:transition-none" />
        <span>Criar</span>
        <ChevronDown size={13} strokeWidth={2} className={`transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>

      {aberto && (
        <div
          role="menu"
          aria-label="O que vamos capturar?"
          onKeyDown={aoTeclarNoMenu}
          className="ecos-fade-in absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-border bg-surface-2 p-1 shadow-nav"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">O que vamos capturar?</p>
          {ITENS.map(({ tipo, rotulo, Icone }) => (
            <button
              key={tipo}
              type="button"
              role="menuitem"
              onClick={() => {
                setAberto(false);
                abrirCaptura(tipo, tipo === "transacao" ? diaCofre : null);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-text-primary hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none"
            >
              <Icone size={16} strokeWidth={1.75} className="text-steel-300" />
              {rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
