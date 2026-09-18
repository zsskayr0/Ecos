import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { ChevronLeft, Search as SearchIcon, Clock, Sparkles } from "lucide-react";
import { busca, vault, ApiError, type TransacaoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";

const ATALHOS = ["Notas órfãs", "Tarefas de hoje", "Transações desse mês"];

interface Resultado {
  notas: { id: string; titulo: string; espaco: string; trecho: string }[];
  tarefas: { id: string; titulo: string; espaco: string; status: string }[];
  transacoes: TransacaoApi[];
}

/** Search — at rest: recents + shortcuts. With results: grouped by type, term highlighted in cyan (section 3.3). */
export function SearchScreen() {
  const navigate = useNavigate();
  const abrirDocumento = useAbrirDocumento();
  const [termo, setTermo] = useState("");
  const [debounced, setDebounced] = useState("");
  const [resultados, setResultados] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recentes, setRecentes] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("ecos-buscas-recentes") ?? "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const t = setTimeout(() => setDebounced(termo.trim()), 300);
    return () => clearTimeout(t);
  }, [termo]);

  useEffect(() => {
    if (!debounced) {
      setResultados(null);
      return;
    }
    let vivo = true;
    setErro(null);
    Promise.all([
      busca.buscar(debounced),
      vault.transacoes.listar({ limit: 200 }).catch(() => ({ items: [] as TransacaoApi[] })),
    ])
      .then(([r, tx]) => {
        if (!vivo) return;
        const termoBaixo = debounced.toLowerCase();
        setResultados({
          notas: r.notas,
          tarefas: r.tarefas,
          transacoes: tx.items.filter((t) => t.descricao.toLowerCase().includes(termoBaixo)),
        });
        setRecentes((prev) => {
          const proximo = [debounced, ...prev.filter((r) => r !== debounced)].slice(0, 5);
          try {
            localStorage.setItem("ecos-buscas-recentes", JSON.stringify(proximo));
          } catch {
            /* localStorage unavailable — just doesn't persist across sessions */
          }
          return proximo;
        });
      })
      .catch((e) => {
        if (!vivo) return;
        setErro(e instanceof ApiError ? e.message : "Não foi possível buscar.");
      });
    return () => {
      vivo = false;
    };
  }, [debounced]);

  const totalResultados = useMemo(
    () => (resultados ? resultados.notas.length + resultados.tarefas.length + resultados.transacoes.length : 0),
    [resultados],
  );

  return (
    <div className="px-4 pt-1">
      <div className="mb-5 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="text-text-muted">
          <ChevronLeft size={22} />
        </button>
        <div className="flex flex-1 items-center gap-2 rounded-2xl bg-surface-1 px-4 py-2.5">
          <SearchIcon size={16} strokeWidth={1.75} className="text-text-muted" />
          <input
            autoFocus
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar Notas, Tarefas, Transações..."
            className="w-full bg-transparent text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </div>
      </div>

      {erro && <p className="mb-4 text-sm text-error">{erro}</p>}

      {!debounced ? (
        <div className="flex flex-col gap-6">
          {recentes.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Buscas recentes</p>
              <div className="flex flex-col gap-1">
                {recentes.map((b) => (
                  <button key={b} onClick={() => setTermo(b)} className="flex items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm text-text-secondary hover:bg-surface-1">
                    <Clock size={15} className="text-text-muted" />
                    {b}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Atalhos rápidos</p>
            <div className="flex flex-wrap gap-2">
              {ATALHOS.map((a) => (
                <button key={a} onClick={() => setTermo(a)} className="flex items-center gap-1.5 rounded-pill border border-border bg-surface-1 px-3 py-1.5 text-sm text-text-secondary">
                  <Sparkles size={13} className="text-steel-300" />
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : !resultados ? (
        <p className="py-10 text-center text-sm text-text-muted">Buscando...</p>
      ) : totalResultados === 0 ? (
        <p className="py-10 text-center text-sm text-text-muted">Nada encontrado pra "{debounced}".</p>
      ) : (
        <div className="flex flex-col gap-6 pb-nav-safe">
          <Grupo titulo="Notas" vazio={resultados.notas.length === 0}>
            {resultados.notas.map((n) => (
              <button key={n.id} onClick={(e) => abrirDocumento(`/notas/nota/${n.id}`, e)} className="w-full rounded-xl bg-surface-1 px-3.5 py-3 text-left">
                <p className="text-[15px] font-medium text-text-primary">{destacar(n.titulo, debounced)}</p>
                <p className="text-xs text-text-muted" dangerouslySetInnerHTML={{ __html: trechoParaHtml(n.trecho) }} />
              </button>
            ))}
          </Grupo>
          <Grupo titulo="Tarefas" vazio={resultados.tarefas.length === 0}>
            {resultados.tarefas.map((t) => (
              <button key={t.id} onClick={(e) => abrirDocumento(`/tarefa/${t.id}`, e)} className="w-full rounded-xl bg-surface-1 px-3.5 py-3 text-left">
                <p className="text-[15px] font-medium text-text-primary">{destacar(t.titulo, debounced)}</p>
                <p className="text-xs text-text-muted">{t.status}</p>
              </button>
            ))}
          </Grupo>
          <Grupo titulo="Transações" vazio={resultados.transacoes.length === 0}>
            {resultados.transacoes.map((tx) => (
              <button key={tx.id} onClick={() => navigate(`/cofre/transacao/${tx.id}`)} className="w-full rounded-xl bg-surface-1 px-3.5 py-3 text-left">
                <p className="text-[15px] font-medium text-text-primary">{destacar(tx.descricao, debounced)}</p>
                <p className="font-mono-value text-xs text-text-muted">{formatMoeda(tx.valor_centavos)}</p>
              </button>
            ))}
          </Grupo>
        </div>
      )}
    </div>
  );
}

function Grupo({ titulo, vazio, children }: { titulo: string; vazio: boolean; children: React.ReactNode }) {
  if (vazio) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{titulo}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

/** Escapes HTML before reintroducing FTS5's `snippet()` `[...]` markers as `<span>` (avoids injection via the Nota's own content). */
function trechoParaHtml(trecho: string) {
  const escapado = trecho.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escapado.replace(/\[/g, '<span class="text-cyan">').replace(/\]/g, "</span>");
}

function destacar(texto: string, termo: string) {
  if (!termo.trim()) return texto;
  const idx = texto.toLowerCase().indexOf(termo.toLowerCase());
  if (idx === -1) return texto;
  return (
    <>
      {texto.slice(0, idx)}
      <span className="text-cyan">{texto.slice(idx, idx + termo.length)}</span>
      {texto.slice(idx + termo.length)}
    </>
  );
}
