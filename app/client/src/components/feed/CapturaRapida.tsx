import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckSquare, FileText, Loader2 } from "lucide-react";
import { notas, tarefas } from "@/lib/api";
import { useAppUI } from "@/lib/ui-context";
import { useRefreshBus } from "@/lib/refresh-bus";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";

import { mensagemDeErro } from "@/lib/erros";
import { avisar } from "@/lib/toast";
import { consumirFocoNaCaptura } from "@/lib/primeiros-passos";
import { dataDoPrazoRapido, ehDispositivoDeToque, type PrazoRapido } from "@/lib/captura-toque";
const TITULO_MAX = 120;

/** Primeira linha vira título; o resto, corpo. Linha única longa demais vai inteira para o corpo. */
function separar(texto: string): { titulo: string; corpo: string } {
  const [primeira, ...resto] = texto.trim().split("\n");
  if (primeira.length > TITULO_MAX) return { titulo: primeira.slice(0, 60).trim() + "…", corpo: texto.trim() };
  return { titulo: primeira.trim(), corpo: resto.join("\n").trim() };
}

/**
 * Captura rápida no topo do Feed. No toque, Enter quebra a linha e os botões "Nota"/"Tarefa" enviam; Hoje/Amanhã
 * definem o prazo da tarefa. Com teclado físico: Enter cria uma nota (ou tarefa, se assim estiver nas preferências), Ctrl+Enter o outro, Shift+Enter quebra a linha.
 * O item aparece na hora (o feed é atualizado pelo refresh-bus).
 */
export function CapturaRapida() {
  const { espacoAtivo } = useAppUI();
  const { notificar } = useRefreshBus();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const toque = ehDispositivoDeToque();
  const [prazo, setPrazo] = useState<PrazoRapido | null>(null);
  useEffect(() => { if (consumirFocoNaCaptura()) campo.current?.focus(); }, []);

  async function criar(tipo: "nota" | "tarefa") {
    if (!texto.trim() || enviando) return;
    const { titulo, corpo } = separar(texto);
    setEnviando(true); setErro(null);
    try {
      const criado = tipo === "nota"
        ? await notas.criar({ titulo, corpo, espaco: espacoAtivo })
        : await tarefas.criar({ titulo, corpo: corpo || undefined, espaco: espacoAtivo, ...(prazo ? { due_date: dataDoPrazoRapido(prazo) } : {}) });
      setTexto(""); setPrazo(null); notificar();
      // Confirmação visível + próximo passo: abrir o item recém-criado.
      const rota = tipo === "nota" ? `/notas/nota/${criado.id}` : `/tarefa/${criado.id}`;
      avisar(tipo === "nota" ? "Nota salva no Feed." : "Tarefa criada no Feed.", "sucesso", { rotulo: "Abrir", aoClicar: () => navigate(rota) });
    } catch (e) {
      setErro(mensagemDeErro(e, "Não consegui salvar a captura. Confira sua conexão e tente de novo."));
    } finally {
      setEnviando(false);
      campo.current?.focus();
    }
  }

  return (
    <div className="rounded-card border border-border bg-surface-1 p-3 focus-within:border-steel-400">
      <textarea
        ref={campo}
        value={texto}
        rows={texto.includes("\n") ? Math.min(6, texto.split("\n").length + 1) : 1}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          // No toque não há Ctrl/Shift+Enter: Enter quebra a linha e os botões enviam.
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || toque) return;
          e.preventDefault();
          const { capturaEnter } = lerPreferenciasAplicativo();
          const outro = capturaEnter === "nota" ? "tarefa" : "nota";
          void criar(e.ctrlKey || e.metaKey ? outro : capturaEnter);
        }}
        placeholder="O que está na sua cabeça?"
        aria-label="Captura rápida"
        className="w-full resize-none bg-transparent text-[15px] text-text-primary outline-none placeholder:text-text-muted"
      />
      {(texto.trim() || erro) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {erro && <p role="alert" className="mr-auto text-xs text-error">{erro}</p>}
          <span role="group" aria-label="Prazo da tarefa" className="mr-auto flex items-center gap-1.5">
            {(["hoje", "amanha"] as const).map((p) => (
              <button key={p} type="button" aria-pressed={prazo === p} onClick={() => setPrazo((atual) => (atual === p ? null : p))} className={`min-h-9 rounded-lg px-2.5 text-xs ${prazo === p ? "bg-cyan/20 text-text-primary" : "bg-surface-2 text-text-secondary"}`}>
                {p === "hoje" ? "Hoje" : "Amanhã"}
              </button>
            ))}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {enviando && <Loader2 size={15} className="animate-spin text-text-muted" />}
            <button type="button" disabled={enviando} onClick={() => void criar("tarefa")} className="flex min-h-8 items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 text-xs text-text-primary hover:bg-surface-3 disabled:opacity-40"><CheckSquare size={14} className="text-cyan" />Tarefa{prazo ? ` · ${prazo === "hoje" ? "hoje" : "amanhã"}` : ""}{!toque && <kbd className="text-[10px] text-text-muted">Ctrl+↵</kbd>}</button>
            <button type="button" disabled={enviando} onClick={() => void criar("nota")} className="flex min-h-8 items-center gap-1.5 rounded-lg bg-steel-500 px-2.5 text-xs font-medium text-white hover:bg-steel-400 disabled:opacity-40"><FileText size={14} />Nota<kbd className="text-[10px] text-white/70">↵</kbd></button>
          </span>
        </div>
      )}
    </div>
  );
}
