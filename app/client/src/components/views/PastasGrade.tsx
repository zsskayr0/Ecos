import { useState } from "react";
import { ChevronDown, Folder, FolderPlus } from "lucide-react";

export interface PastaResumo {
  caminho: string;
  nome: string;
  contagem_itens: number;
}

interface Props {
  pastas: PastaResumo[];
  /** Identifica o módulo (`notas`/`tarefas`): ocultar pastas vale para todas as telas dele. */
  chave: "notas" | "tarefas";
  titulo?: string;
  corIcone: string;
  aoAbrir: (pasta: PastaResumo) => void;
  /** Quando presente, mostra o bloco tracejado "Nova pasta". */
  aoCriar?: () => void;
}

const chaveOcultas = (chave: string) => `ecos:pastas-ocultas:${chave}`;

function lerOcultas(chave: string): boolean {
  try {
    return localStorage.getItem(chaveOcultas(chave)) === "1";
  } catch {
    return false;
  }
}

/**
 * Pastas como blocos quadrados (1:1), quantos couberem por linha. O botão do
 * cabeçalho oculta e mostra todas de uma vez — a escolha vale para o módulo
 * inteiro e fica guardada.
 */
export function PastasGrade({ pastas, chave, titulo = "Pastas", corIcone, aoAbrir, aoCriar }: Props) {
  const [ocultas, setOcultas] = useState(() => lerOcultas(chave));

  function alternar() {
    const proximo = !ocultas;
    setOcultas(proximo);
    try {
      localStorage.setItem(chaveOcultas(chave), proximo ? "1" : "0");
    } catch {
      /* só não persiste */
    }
  }

  return (
    <section aria-label={titulo}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {titulo}
          <span className="ml-1.5 font-mono-value normal-case tracking-normal">{pastas.length}</span>
        </p>
        <button
          type="button"
          aria-expanded={!ocultas}
          onClick={alternar}
          className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"
        >
          {ocultas ? "Mostrar" : "Ocultar"}
          <ChevronDown size={14} strokeWidth={1.75} className={`transition-transform ${ocultas ? "" : "rotate-180"}`} />
        </button>
      </div>

      {!ocultas && (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
          {pastas.map((p) => (
            <button
              key={p.caminho}
              type="button"
              onClick={() => aoAbrir(p)}
              className="flex aspect-square min-w-0 flex-col justify-between rounded-card bg-surface-1 p-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"
            >
              <Folder size={28} strokeWidth={1.5} className={corIcone} />
              <span className="min-w-0">
                <span className="line-clamp-2 block break-words font-body text-[15px] font-semibold leading-snug text-text-primary">{p.nome}</span>
                <span className="mt-0.5 block text-xs text-text-muted">{p.contagem_itens} {p.contagem_itens === 1 ? "item" : "itens"}</span>
              </span>
            </button>
          ))}
          {aoCriar && (
            <button
              type="button"
              onClick={aoCriar}
              className="flex aspect-square flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border text-text-muted transition-colors hover:border-steel-500/60 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"
            >
              <FolderPlus size={22} strokeWidth={1.5} />
              <span className="text-xs font-medium">Nova pasta</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
