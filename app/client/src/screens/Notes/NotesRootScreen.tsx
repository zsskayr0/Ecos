import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { pastas, notas as notasApi, ApiError, type NotaResumo } from "@/lib/api";
import { notaResumoParaView } from "@/lib/adapters";
import { ListaDeItens } from "@/components/views/ListaDeItens";
import { PastasGrade } from "@/components/views/PastasGrade";
import { ViewModeToggle, useModoVisualizacao } from "@/components/common/ViewModeToggle";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { useAuth } from "@/lib/auth-context";
import { SoltarMarkdown } from "@/components/common/SoltarMarkdown";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useAppUI } from "@/lib/ui-context";

/**
 * Notas — root-level folder grid (section 3.2), reading the real
 * `GET /api/v1/pastas`. GAP-10: the real response doesn't mark a subfolder
 * as Personal/Team (`app/server/src/routes/pastas.rs` doesn't return
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
  const { espacoAtivo, intercalarEquipes, filtroEquipeId } = useAppUI();
  const [modo, setModo] = useModoVisualizacao("notas");
  const [subpastas, setSubpastas] = useState<{ caminho: string; nome: string; contagem_itens: number }[] | null>(null);
  const [soltas, setSoltas] = useState<NotaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const espaco = intercalarEquipes ? (filtroEquipeId ? `equipe:${filtroEquipeId}` : undefined) : espacoAtivo;
    Promise.all([pastas.listar({ tipo: "nota", espaco }), notasApi.listar({ espaco, limit: 100 })])
      .then(([p, n]) => {
        setSubpastas(p.subpastas);
        setSoltas(n.items);
      })
      .catch((e) => setErro(e instanceof ApiError ? e.message : "Não foi possível carregar as pastas."));
  }, [versao, espacoAtivo, intercalarEquipes, filtroEquipeId]);

  return (
    <SoltarMarkdown className="min-h-full px-4 pt-1">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl text-text-primary">Notas</h1>
        <div className="flex items-center gap-2"><ViewModeToggle modo={modo} onMudar={setModo} /></div>
      </div>

      {erro && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      <PastasGrade
        chave="notas"
        corIcone="text-steel-300"
        pastas={subpastas ?? []}
        aoAbrir={(p) => navigate(`/notas/pasta/${encodeURIComponent(p.caminho)}`)}
        aoCriar={() => navigate("/notas/pasta/nova")}
      />

      <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-text-muted">Sem pasta</p>
      <div>
        {soltas === null ? (
          <p className="py-6 text-center text-sm text-text-muted">Carregando...</p>
        ) : soltas.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">
            Nenhuma nota solta — tudo o que você tem está catalogado numa pasta.
          </p>
        ) : (
          <ListaDeItens chave="notas" mostrarCriada modo={modo} itens={soltas.map((n) => notaResumoParaView(n, equipes, perfil))} />
        )}
      </div>
    </SoltarMarkdown>
  );
}
