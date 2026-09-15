import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Folder, FolderPlus, AlertTriangle } from "lucide-react";
import { pastas, ApiError } from "@/lib/api";
import { useRefreshBus } from "@/lib/refresh-bus";

/**
 * Notas — grade de pastas na raiz (seção 3.2), lendo `GET /api/v1/pastas`
 * de verdade. GAP-10: a resposta real não marca subpasta como
 * Pessoal/Equipe (`apps/server/src/routes/pastas.rs` não devolve `espaco`
 * por subpasta, só por Nota/Documento dentro dela) — cor uniforme até o
 * backend expor isso.
 */
export function NotesRootScreen() {
  const navigate = useNavigate();
  const { versao } = useRefreshBus();
  const [subpastas, setSubpastas] = useState<{ caminho: string; nome: string; contagem_itens: number }[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    pastas
      .listar({ tipo: "nota" })
      .then((r) => setSubpastas(r.subpastas))
      .catch((e) => setErro(e instanceof ApiError ? e.message : "Não foi possível carregar as pastas."));
  }, [versao]);

  return (
    <div className="px-4 pt-1">
      <h1 className="mb-4 font-display text-2xl text-text-primary">Notas</h1>

      {erro && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {subpastas?.map((p) => (
          <button
            key={p.caminho}
            onClick={() => navigate(`/notas/pasta/${encodeURIComponent(p.caminho)}`)}
            className="flex flex-col items-start gap-3 rounded-card bg-surface-1 p-4 text-left"
          >
            <Folder size={28} strokeWidth={1.5} className="text-steel-300" />
            <div>
              <p className="font-body text-[15px] font-semibold text-text-primary">{p.nome}</p>
              <p className="text-xs text-text-muted">{p.contagem_itens} itens</p>
            </div>
          </button>
        ))}
        <button
          onClick={() => navigate("/notas/pasta/nova")}
          className="flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border text-text-muted"
        >
          <FolderPlus size={22} strokeWidth={1.5} />
          <span className="text-xs font-medium">Nova pasta</span>
        </button>
      </div>

      {subpastas?.length === 0 && (
        <p className="mt-4 text-center text-sm text-text-muted">
          Nenhuma pasta ainda — as Notas soltas aparecem direto no Feed e na Busca.
        </p>
      )}
    </div>
  );
}
