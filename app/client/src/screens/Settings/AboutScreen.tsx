import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { auth } from "@/lib/api";

/** GAP-04 (continued): "Sobre o Ecos" listed in the Settings index with no detailed content. */
export function AboutScreen() {
  const navigate = useNavigate();
  // Versão = release do servidor a que este cliente está conectado.
  const [versao, setVersao] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    auth.status().then((s) => vivo && setVersao(s.versao)).catch(() => {});
    return () => { vivo = false; };
  }, []);
  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-8 flex items-center gap-2">
        <button data-voltar onClick={() => navigate(-1)} className="text-text-muted">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl text-text-primary">Sobre</h1>
      </div>

      <div className="flex flex-col items-center gap-2 text-center">
        <p className="font-display text-4xl text-text-primary">Ecos</p>
        <p className="text-sm text-text-secondary">Seu cofre vivo de notas, tempo e dinheiro.</p>
        <p className="mt-2 font-mono-value text-xs text-text-muted">{versao ? `v${versao}` : "—"}</p>
      </div>

      <div className="mt-10 flex flex-col gap-1 text-sm text-text-muted">
        <p>Local-first: Notas e Tarefas vivem em arquivos .md nesta instância.</p>
        <p>Sem conta em nuvem de terceiro — identidade é local (seção 5.1).</p>
        <p>Rust em toda a base: cliente e servidor.</p>
      </div>

      <Link
        to="/configuracoes/sobre/licencas"
        className="mt-8 flex items-center justify-between rounded-xl border border-border bg-base p-3 text-sm text-text-primary transition-colors hover:border-steel-400 hover:bg-surface-2"
      >
        Licenças de código aberto
        <ChevronRight size={17} className="text-text-muted" aria-hidden="true" />
      </Link>
    </div>
  );
}
