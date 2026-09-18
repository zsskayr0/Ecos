import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Folder, AlertTriangle } from "lucide-react";
import { ListaDeItens } from "@/components/views/ListaDeItens";
import { PastasGrade } from "@/components/views/PastasGrade";
import { ViewModeToggle, useModoVisualizacao } from "@/components/common/ViewModeToggle";
import { EmptyState } from "@/components/common/EmptyState";
import { notas as notasApi, pastas as pastasApi, ApiError, type NotaResumo } from "@/lib/api";
import { notaResumoParaView } from "@/lib/adapters";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { useAuth } from "@/lib/auth-context";
import { useRefreshBus } from "@/lib/refresh-bus";

/** Inside a folder — compact subfolders at the top, notes below with the same card as the Feed (section 3.2). */
export function FolderScreen() {
  const { pastaId } = useParams();
  const caminho = decodeURIComponent(pastaId ?? "");
  const nomeExibicao = caminho.split("/").pop() ?? caminho;
  const navigate = useNavigate();
  const { equipes } = useMinhasEquipes();
  const { perfil } = useAuth();
  const { versao } = useRefreshBus();
  const [modo, setModo] = useModoVisualizacao("notas");

  const [subpastas, setSubpastas] = useState<{ caminho: string; nome: string; contagem_itens: number }[]>([]);
  const [notas, setNotas] = useState<NotaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([pastasApi.listar({ tipo: "nota", pasta_pai: caminho }), notasApi.listar({ pasta: caminho, limit: 100 })])
      .then(([p, n]) => {
        if (!vivo) return;
        setSubpastas(p.subpastas);
        setNotas(n.items);
      })
      .catch((e) => {
        if (!vivo) return;
        setErro(e instanceof ApiError ? e.message : "Não foi possível carregar esta pasta.");
        setNotas([]);
      });
    return () => {
      vivo = false;
    };
  }, [caminho, versao]);

  return (
    <div className="px-4 pt-1">
      <button onClick={() => navigate(-1)} className="mb-3 flex items-center gap-1 text-sm text-text-muted">
        <ChevronLeft size={18} />
        Notas
      </button>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 font-display text-2xl text-text-primary">
          <Folder size={22} className="text-steel-300" />
          {nomeExibicao}
        </h1>
        <ViewModeToggle modo={modo} onMudar={setModo} />
      </div>

      {erro && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      {subpastas.length > 0 && (
        <div className="mb-4">
          <PastasGrade
            chave="notas"
            titulo="Subpastas"
            corIcone="text-steel-300"
            pastas={subpastas}
            aoAbrir={(p) => navigate(`/notas/pasta/${encodeURIComponent(p.caminho)}`)}
          />
        </div>
      )}

      <div>
        {notas === null ? (
          <p className="py-10 text-center text-sm text-text-muted">Carregando...</p>
        ) : notas.length === 0 ? (
          <EmptyState icon={Folder} title="Pasta vazia por enquanto." subtitle="Toque no + pra criar a primeira nota aqui." />
        ) : (
          <ListaDeItens chave="notas" mostrarCriada modo={modo} itens={notas.map((n) => notaResumoParaView(n, equipes, perfil))} />
        )}
      </div>
    </div>
  );
}
