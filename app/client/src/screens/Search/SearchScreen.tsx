import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { ChevronLeft, Search as SearchIcon, Clock } from "lucide-react";
import { busca, vault, type TransacaoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { EstadoCarregando } from "@/components/common/EstadoCarregando";
import { EstadoErro } from "@/components/common/EstadoErro";
import { EmptyState } from "@/components/common/EmptyState";

import { mensagemDeErro } from "@/lib/erros";
type Escopo = "tudo" | "notas" | "tarefas" | "transacoes";
const ESCOPOS: { id: Escopo; rotulo: string }[] = [
  { id: "tudo", rotulo: "Tudo" },
  { id: "notas", rotulo: "Só notas" },
  { id: "tarefas", rotulo: "Só tarefas" },
  { id: "transacoes", rotulo: "Só transações" },
];
const CHAVE_RECENTES = "ecos-buscas-recentes";
const ROTULO_STATUS: Record<string, string> = { pendente: "Pendente", concluida: "Concluída" };

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
  const [tentativa, setTentativa] = useState(0);
  const [escopo, setEscopo] = useState<Escopo>("tudo");
  const [recentes, setRecentes] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(CHAVE_RECENTES) ?? "[]");
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
    const semTransacoes = escopo === "notas" || escopo === "tarefas";
    Promise.all([
      escopo === "transacoes" ? Promise.resolve({ notas: [], tarefas: [] }) : busca.buscar(debounced, escopo === "notas" ? { tipo: "nota" } : escopo === "tarefas" ? { tipo: "tarefa" } : {}),
      semTransacoes ? Promise.resolve({ items: [] as TransacaoApi[] }) : vault.transacoes.listar({ limit: 200 }).catch(() => ({ items: [] as TransacaoApi[] })),
    ])
      .then(([r, tx]) => {
        if (!vivo) return;
        const termoBaixo = debounced.toLowerCase();
        setResultados({
          notas: escopo === "tarefas" ? [] : r.notas,
          tarefas: escopo === "notas" ? [] : r.tarefas,
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
        setErro(mensagemDeErro(e, "Não consegui buscar agora. Confira sua conexão e tente de novo."));
      });
    return () => {
      vivo = false;
    };
  }, [debounced, tentativa, escopo]);

  function limparRecentes() {
    setRecentes([]);
    try { localStorage.removeItem(CHAVE_RECENTES); } catch { /* sem armazenamento local: nada a limpar */ }
  }

  const totalResultados = useMemo(
    () => (resultados ? resultados.notas.length + resultados.tarefas.length + resultados.transacoes.length : 0),
    [resultados],
  );

  return (
    <div className="px-4 pt-1">
      <div className="mb-5 flex items-center gap-2">
        <button aria-label="Voltar" onClick={() => navigate(-1)} className="text-text-muted">
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

      {debounced && <div className="mb-4"><FiltroEscopo escopo={escopo} aoMudar={setEscopo} /></div>}

      {erro && <EstadoErro mensagem={erro} onTentarDeNovo={() => setTentativa((n) => n + 1)} />}

      {!debounced ? (
        <div className="flex flex-col gap-6">
          {recentes.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Buscas recentes</p>
                <button type="button" onClick={limparRecentes} className="min-h-11 px-2 text-xs font-medium text-text-muted hover:text-text-primary">Limpar</button>
              </div>
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
          <FiltroEscopo escopo={escopo} aoMudar={setEscopo} />
        </div>
      ) : erro ? null : !resultados ? (
        <EstadoCarregando texto="Buscando…" />
      ) : totalResultados === 0 ? (
        <EmptyState icon={SearchIcon} title={`Nada encontrado pra "${debounced}".`} subtitle="Tente outra palavra ou um trecho menor." />
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
                <p className="text-xs text-text-muted">{ROTULO_STATUS[t.status] ?? "Pendente"}</p>
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

/** Escopo da busca: filtra de verdade o que a pesquisa procura (e o que aparece nos resultados). */
function FiltroEscopo({ escopo, aoMudar }: { escopo: Escopo; aoMudar: (e: Escopo) => void }) {
  return (
    <div role="group" aria-label="Buscar em" className="flex flex-wrap gap-2">
      {ESCOPOS.map((e) => (
        <button
          key={e.id}
          type="button"
          aria-pressed={escopo === e.id}
          onClick={() => aoMudar(e.id)}
          className={`min-h-9 rounded-pill border px-3 py-1.5 text-sm ${escopo === e.id ? "border-cyan bg-cyan/10 text-text-primary" : "border-border bg-surface-1 text-text-secondary"}`}
        >
          {e.rotulo}
        </button>
      ))}
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
