import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Folder, Plus, X } from "lucide-react";
import { ApiError, notas, pastas } from "@/lib/api";
import { useIsMobile } from "@/lib/use-viewport";

interface Props {
  /** Espaço (Pessoal/equipe) cujas pastas são listadas e onde novas pastas nascem. */
  espaco?: string;
  pasta: string | null;
  onPasta: (pasta: string | null) => void;
  /** Tags escolhidas aqui (removíveis). */
  tags: string[];
  /** Tags que vêm de `#hashtags` no texto — aparecem, mas só saem apagando do texto. */
  tagsNoTexto: string[];
  onTags: (tags: string[]) => void;
  disabled?: boolean;
}

const normalizarTag = (bruta: string) => bruta.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase();

/**
 * Pasta e tags da nota numa faixa só, sem abrir painel lateral: a pasta é um
 * menu com "criar pasta" embutido; as tags são chips com campo de adição e
 * sugestões das tags que você mais usa nas outras notas.
 */
export function NoteOrganizer({ espaco, pasta, onPasta, tags, tagsNoTexto, onTags, disabled }: Props) {
  const mobile = useIsMobile();
  const [pastasLista, setPastasLista] = useState<{ caminho: string; nome: string }[]>([]);
  const [menuAberto, setMenuAberto] = useState(false);
  const [novaPasta, setNovaPasta] = useState("");
  const [criando, setCriando] = useState(false);
  const [erroPasta, setErroPasta] = useState<string | null>(null);
  const [novaTag, setNovaTag] = useState("");
  const [frequentes, setFrequentes] = useState<string[]>([]);
  const raiz = useRef<HTMLDivElement>(null);

  const carregarPastas = () =>
    pastas.listar({ tipo: "nota", espaco }).then((r) => setPastasLista(r.subpastas)).catch(() => undefined);

  useEffect(() => {
    let vivo = true;
    pastas.listar({ tipo: "nota", espaco }).then((r) => vivo && setPastasLista(r.subpastas)).catch(() => undefined);
    notas
      .listar({ limit: 100 })
      .then((r) => {
        if (!vivo) return;
        const contagem = new Map<string, number>();
        for (const n of r.items) for (const t of n.tags) contagem.set(t, (contagem.get(t) ?? 0) + 1);
        setFrequentes([...contagem.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t));
      })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [espaco]);

  useEffect(() => {
    if (!menuAberto) return;
    const fora = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setMenuAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [menuAberto]);

  const todas = [...new Set([...tags, ...tagsNoTexto])];
  const sugestoes = frequentes.filter((t) => !todas.includes(t)).slice(0, 5);
  const nomeDaPasta = pasta ? pastasLista.find((p) => p.caminho === pasta)?.nome ?? pasta : "Sem pasta";

  function adicionarTag(bruta: string) {
    const tag = normalizarTag(bruta);
    if (tag && !todas.includes(tag)) onTags([...tags, tag]);
    setNovaTag("");
  }

  async function criarPasta() {
    const nome = novaPasta.trim();
    if (!nome || criando) return;
    setCriando(true);
    setErroPasta(null);
    try {
      const { caminho } = await pastas.criar({ tipo: "nota", nome, espaco });
      await carregarPastas();
      onPasta(caminho);
      setNovaPasta("");
      setMenuAberto(false);
    } catch (e) {
      setErroPasta(e instanceof ApiError ? e.message : "Não foi possível criar a pasta.");
    } finally {
      setCriando(false);
    }
  }

  const opcao = (caminho: string, nome: string) => {
    const selecionada = (pasta ?? "") === caminho;
    return (
      <button
        key={caminho || "raiz"}
        type="button"
        role="option"
        aria-selected={selecionada}
        onClick={() => { onPasta(caminho || null); setMenuAberto(false); }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-text-primary hover:bg-surface-3"
      >
        <span className="min-w-0 flex-1 truncate">{nome}</span>
        {selecionada && <Check size={14} className="shrink-0 text-steel-300" />}
      </button>
    );
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label="Pasta e tags">
      <div ref={raiz} className="relative">
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={menuAberto}
          onClick={() => setMenuAberto((v) => !v)}
          className="flex h-9 max-w-[16rem] items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text-primary hover:border-steel-500/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 disabled:opacity-50"
        >
          <Folder size={15} className="shrink-0 text-steel-300" />
          <span className="truncate">{nomeDaPasta}</span>
          <ChevronDown size={14} className={`shrink-0 text-text-muted transition-transform ${menuAberto ? "rotate-180" : ""}`} />
        </button>
        {menuAberto && (
          <>
          {mobile && <button type="button" aria-label="Fechar seleção de pasta" onClick={() => setMenuAberto(false)} className="fixed inset-0 z-40 cursor-default bg-black/60" />}
          <div className={`ecos-fade-in border border-border bg-surface-2 shadow-nav ${mobile ? "fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 max-h-[min(70vh,34rem)] overflow-y-auto rounded-2xl p-2" : "absolute left-0 top-full z-30 mt-1 w-64 rounded-xl p-1"}`}>
            {mobile && <div className="mb-1 flex items-center justify-between px-2 pt-1"><div><p className="text-base font-semibold text-text-primary">Mover para pasta</p><p className="text-xs text-text-muted">Escolha onde esta nota será organizada.</p></div><button type="button" onClick={() => setMenuAberto(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-3" aria-label="Fechar"><X size={17} /></button></div>}
            <div role="listbox" aria-label="Pasta da nota" className="max-h-56 overflow-y-auto">
              {opcao("", "Sem pasta")}
              {pastasLista.map((p) => opcao(p.caminho, p.nome))}
            </div>
            <form
              className="mt-1 flex items-center gap-1 border-t border-border pt-1.5"
              onSubmit={(e) => { e.preventDefault(); void criarPasta(); }}
            >
              <input
                value={novaPasta}
                onChange={(e) => setNovaPasta(e.target.value)}
                placeholder="Nova pasta"
                aria-label="Nome da nova pasta"
                className="h-8 min-w-0 flex-1 rounded-lg bg-surface-1 px-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:ring-1 focus:ring-steel-400"
              />
              <button type="submit" disabled={!novaPasta.trim() || criando} aria-label="Criar pasta" className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-3 text-text-secondary hover:text-text-primary disabled:opacity-40">
                <Plus size={15} />
              </button>
            </form>
            {erroPasta && <p role="alert" className="px-2 pt-1 text-xs text-error">{erroPasta}</p>}
          </div>
          </>
        )}
      </div>

      <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />

      {todas.map((tag) => {
        const noTexto = tagsNoTexto.includes(tag) && !tags.includes(tag);
        return (
          <span key={tag} className="flex h-8 items-center gap-1 rounded-lg bg-surface-2 pl-2.5 pr-1 text-sm text-text-secondary" title={noTexto ? "Vem do texto da nota" : undefined}>
            <span className="max-w-[10rem] truncate">#{tag}</span>
            {noTexto ? <span className="w-1.5" /> : (
              <button type="button" disabled={disabled} onClick={() => onTags(tags.filter((t) => t !== tag))} aria-label={`Remover tag ${tag}`} className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary">
                <X size={13} />
              </button>
            )}
          </span>
        );
      })}

      <input
        value={novaTag}
        disabled={disabled}
        onChange={(e) => setNovaTag(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); adicionarTag(novaTag); }
          else if (e.key === "Backspace" && !novaTag && tags.length) onTags(tags.slice(0, -1));
        }}
        onBlur={() => novaTag && adicionarTag(novaTag)}
        placeholder="+ tag"
        aria-label="Adicionar tag"
        className="h-8 w-24 rounded-lg bg-transparent px-2 text-sm text-text-primary outline-none transition-[width] placeholder:text-text-muted focus:w-40 focus:bg-surface-2"
      />

      {sugestoes.map((tag) => (
        <button key={tag} type="button" disabled={disabled} onClick={() => adicionarTag(tag)} className="h-8 rounded-lg border border-dashed border-border px-2.5 text-sm text-text-muted hover:border-steel-500/60 hover:text-text-primary">
          #{tag}
        </button>
      ))}
    </div>
  );
}
