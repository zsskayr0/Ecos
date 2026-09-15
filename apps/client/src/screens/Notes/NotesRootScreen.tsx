import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Folder, FolderPlus, AlertTriangle } from "lucide-react";
import { pastas, notas as notasApi, ApiError, type NotaResumo } from "@/lib/api";
import { notaResumoParaView } from "@/lib/adapters";
import { NoteCard } from "@/components/cards/NoteCard";
import { NoteListRow } from "@/components/cards/NoteListRow";
import { ViewModeToggle, useModoVisualizacao } from "@/components/common/ViewModeToggle";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { useAuth } from "@/lib/auth-context";
import { useRefreshBus } from "@/lib/refresh-bus";

/**
 * Notas — root-level folder grid (section 3.2), reading the real
 * `GET /api/v1/pastas`. GAP-10: the real response doesn't mark a subfolder
 * as Personal/Team (`apps/server/src/routes/pastas.rs` doesn't return
 * `espaco` per subfolder, only per Nota/Documento inside it) — uniform
 * color until the backend exposes that.
 *
 * User feedback: "a parte de notas precisa ter as notas não catalogadas
 * (órfãs), sem tag ou pasta. como vou visualizar o resto delas?" — this
 * screen used to render only `subpastas`, so a Nota with no folder was
 * invisible here (it still showed up in Feed/Busca, but not while
 * browsing Notas). Now it also lists loose notes (`GET /notas`, no
 * `pasta` param — the backend already treats that as "raiz only", see
 * `notas::listar`), same card the Feed uses, with a Cards/Lista toggle.
 */
export function NotesRootScreen() {
  const navigate = useNavigate();
  const { equipes } = useMinhasEquipes();
  const { perfil } = useAuth();
  const { versao } = useRefreshBus();
  const [modo, setModo] = useModoVisualizacao("notas");
  const [subpastas, setSubpastas] = useState<{ caminho: string; nome: string; contagem_itens: number }[] | null>(null);
  const [soltas, setSoltas] = useState<NotaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([pastas.listar({ tipo: "nota" }), notasApi.listar({ limit: 100 })])
      .then(([p, n]) => {
        setSubpastas(p.subpastas);
        setSoltas(n.items);
      })
      .catch((e) => setErro(e instanceof ApiError ? e.message : "Não foi possível carregar as pastas."));
  }, [versao]);

  return (
    <div className="px-4 pt-1">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl text-text-primary">Notas</h1>
        <ViewModeToggle modo={modo} onMudar={setModo} />
      </div>

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

      <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-text-muted">Sem pasta</p>
      <div className={modo === "cards" ? "flex flex-col gap-3" : "flex flex-col gap-2"}>
        {soltas === null ? (
          <p className="py-6 text-center text-sm text-text-muted">Carregando...</p>
        ) : soltas.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">
            Nenhuma nota solta — tudo o que você tem está catalogado numa pasta.
          </p>
        ) : (
          soltas.map((n) =>
            modo === "cards" ? (
              <NoteCard key={n.id} nota={notaResumoParaView(n, equipes, perfil)} />
            ) : (
              <NoteListRow key={n.id} nota={notaResumoParaView(n, equipes, perfil)} />
            ),
          )
        )}
      </div>
    </div>
  );
}
