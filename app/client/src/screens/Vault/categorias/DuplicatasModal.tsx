import { useEffect, useState } from "react";
import { CopyCheck, GitMerge, X } from "lucide-react";
import type { CategoriaApi } from "@/lib/api";
import { caminhoCompleto } from "@/lib/categorias-hierarquia";
import { CategoriaIcone } from "./icone";
import type { Uso } from "./dados";
import type { GrupoDuplicado } from "./duplicatas";

/** Lista os grupos de categorias com nomes parecidos para mesclar (ou dispensar: "não é duplicata"). */
export function DuplicatasModal({ grupos, porId, usos, onMesclar, onDispensar, onClose }: {
  grupos: GrupoDuplicado[];
  porId: Map<string, CategoriaApi>;
  usos: Map<string, Uso>;
  onMesclar: (g: GrupoDuplicado) => void;
  onDispensar: (g: GrupoDuplicado) => void;
  onClose: () => void;
}) {
  const [saindo, setSaindo] = useState(false);
  function fechar() { setSaindo(true); window.setTimeout(onClose, 160); }
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cofre-cats-modal" data-saindo={saindo || undefined}>
      <div className="cofre-cats-backdrop" onClick={fechar} />
      <section className="cofre-card cofre-cats-dialog cofre-duplicatas" role="dialog" aria-modal="true" aria-label="Revisar duplicatas">
        <header>
          <span className="cofre-cats-icon lg" style={{ background: "var(--panel-elevated)", color: "var(--text)" }}><CopyCheck size={18} /></span>
          <div><p>REVISÃO</p><h2>Categorias parecidas</h2></div>
          <button type="button" className="cofre-cats-iconbtn cofre-cats-fechar" aria-label="Fechar" onClick={fechar}><X size={18} /></button>
        </header>
        {grupos.length === 0 ? (
          <p className="cofre-cats-nota">Nenhuma categoria parecida com outra. Tudo certo por aqui.</p>
        ) : (
          <ul className="cofre-dup-lista">
            {grupos.map((g) => (
              <li key={g.chave} className="cofre-dup-grupo">
                <p className="cofre-dup-motivo">{g.motivo === "espacos" ? "Mesmo nome, escrito de forma diferente" : "Nomes quase iguais"}</p>
                <ul>
                  {g.membros.map((c) => (
                    <li key={c.id} data-fica={c.id === g.principal.id || undefined}>
                      <CategoriaIcone categoria={c} tamanho={11} className="cofre-cats-icon sm" />
                      <b>{caminhoCompleto(c, porId)}</b>
                      <small className="cofre-mono">{usos.get(c.id)?.count ?? 0} lanç.</small>
                      {c.id === g.principal.id && <em>mais usada</em>}
                    </li>
                  ))}
                </ul>
                <div className="cofre-dup-acoes">
                  <button type="button" className="cofre-secondary" onClick={() => onDispensar(g)}>Não é duplicata</button>
                  <button type="button" className="cofre-solid" onClick={() => onMesclar(g)}><GitMerge size={14} />Mesclar…</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <footer><button type="button" className="cofre-secondary" onClick={fechar}>Fechar</button></footer>
      </section>
    </div>
  );
}
