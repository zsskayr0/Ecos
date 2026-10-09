import { EstadoCarregando } from "@/components/common/EstadoCarregando";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, Search } from "lucide-react";

interface Grupo {
  id: string;
  nome: string;
  texto: string;
  /** [nome, versão, ecossistema] */
  pacotes: [string, string, string][];
}
interface Dados {
  geradoEm: string;
  total: number;
  grupos: Grupo[];
}

const MARCAS =
  "Google Calendar, Outlook e Apple Calendar/iCal são marcas registradas de Google LLC, Microsoft Corporation e Apple Inc. " +
  "Aparecem no Ecos só como referência nominativa em texto, para indicar compatibilidade. O Ecos não usa seus logotipos e não é afiliado nem endossado por elas.";

/** Sobre > Licenças de código aberto. Dados gerados por `npm run licencas` (mesma fonte do THIRD-PARTY-NOTICES). */
export function LicensesScreen() {
  const navigate = useNavigate();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState(false);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    import("@/assets/licencas.json")
      .then((m) => vivo && setDados(m.default as Dados))
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
    };
  }, []);

  const grupos = useMemo(() => {
    if (!dados) return [];
    const q = busca.trim().toLowerCase();
    return dados.grupos
      .map((g, indice) => ({ g, indice, pacotes: q ? g.pacotes.filter(([n]) => n.toLowerCase().includes(q)) : g.pacotes }))
      .filter((x) => x.pacotes.length > 0 || (q && x.g.id.toLowerCase().includes(q)));
  }, [dados, busca]);

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-4 flex items-center gap-2">
        <button data-voltar onClick={() => navigate(-1)} aria-label="Voltar" className="text-text-muted">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl text-text-primary">Licenças de código aberto</h1>
      </div>

      <p className="text-sm text-text-secondary">
        O Ecos usa fontes (Inter, Space Grotesk e JetBrains Mono, sob a SIL OFL 1.1), ícones (Lucide) e bibliotecas de código aberto. Seus avisos estão abaixo.
      </p>
      <p className="mt-2 text-xs text-text-muted">{MARCAS}</p>

      <label className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-base px-3 py-2 focus-within:border-steel-400">
        <Search size={16} className="text-text-muted" aria-hidden="true" />
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar pacote ou licença"
          aria-label="Buscar pacote ou licença"
          className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
        />
      </label>

      {erro && <p role="alert" className="mt-6 text-sm text-red-400">Não foi possível carregar a lista de licenças.</p>}
      {!erro && !dados && <EstadoCarregando texto="Carregando…" />}
      {dados && (
        <>
          <p className="mt-3 text-xs text-text-muted">{dados.total} pacotes · gerado em {dados.geradoEm}</p>
          {grupos.length === 0 && <p className="mt-6 text-sm text-text-muted">Nenhum resultado para “{busca}”.</p>}
          <ul className="mt-3 space-y-2">
            {grupos.map(({ g, indice, pacotes }) => {
              const expandido = aberto === indice;
              return (
                <li key={indice} className="rounded-xl border border-border bg-base">
                  <button
                    type="button"
                    aria-expanded={expandido}
                    onClick={() => setAberto(expandido ? null : indice)}
                    className="flex w-full items-center gap-3 p-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-text-primary">{g.id}</span>
                      <span className="block truncate text-xs text-text-muted">
                        {pacotes.length} pacote{pacotes.length > 1 ? "s" : ""}: {pacotes.slice(0, 3).map(([n]) => n).join(", ")}
                        {pacotes.length > 3 ? "…" : ""}
                      </span>
                    </span>
                    <ChevronDown size={16} className={`text-text-muted transition-transform ${expandido ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {expandido && (
                    <div className="border-t border-border p-3">
                      <ul className="mb-3 flex flex-wrap gap-1.5 text-xs text-text-secondary">
                        {pacotes.map(([n, v, eco]) => (
                          <li key={`${eco}:${n}@${v}`} className="rounded-md bg-surface-2 px-1.5 py-0.5">{n} {v}</li>
                        ))}
                      </ul>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono-value text-[11px] leading-relaxed text-text-muted">{g.texto}</pre>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
