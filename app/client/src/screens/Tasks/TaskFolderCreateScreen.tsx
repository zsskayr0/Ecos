import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { pastas, ApiError } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";
import { caminhoPastaNaRota } from "@/lib/pasta-contexto";

/** `POST /api/v1/pastas` with `tipo: "tarefa"` — same mechanism as `FolderCreateScreen` (Notas). */
export function TaskFolderCreateScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const pai = params.get("pai") ?? "";
  const { notificar } = useRefreshBus();
  const espaco = useEspacoFiltro();
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    if (!nome.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await pastas.criar({ tipo: "tarefa", nome: nome.trim(), espaco, pasta_pai: pai || undefined });
      notificar();
      navigate(pai ? `/tarefas/pasta/${caminhoPastaNaRota(pai)}` : "/tarefas");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível criar a pasta.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="px-4 pt-1">
      <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-1 text-sm text-text-muted">
        <ChevronLeft size={18} />
        Cancelar
      </button>

      <h1 className="mb-6 font-display text-2xl text-text-primary">{pai ? "Nova subpasta de tarefas" : "Nova pasta de tarefas"}</h1>

      {pai && <p className="mb-4 break-words text-sm text-text-secondary">Dentro de {pai.split("/").join(" / ")}</p>}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Nome</span>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Projeto X" className="ecos-input" autoFocus />
      </label>

      {erro && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      <button
        onClick={criar}
        disabled={!nome.trim() || salvando}
        className="mt-6 w-full rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white disabled:opacity-40"
      >
        {salvando ? "Criando..." : "Criar pasta"}
      </button>
    </div>
  );
}
