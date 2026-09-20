import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { pastas, ApiError } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";

/** `POST /api/v1/pastas` — a Pasta is just a new directory under `Notas/` (section 1.3/1.5). */
export function FolderCreateScreen() {
  const navigate = useNavigate();
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
      await pastas.criar({ nome: nome.trim(), espaco });
      notificar();
      navigate("/notas");
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

      <h1 className="mb-6 font-display text-2xl text-text-primary">Nova pasta</h1>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Nome</span>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Projetos" className="ecos-input" autoFocus />
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
