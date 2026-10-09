import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CategoriaApi } from "@/lib/api";
import { caminhoCompleto, montarHierarquia } from "@/lib/categorias-hierarquia";
import { CategoriaIcone } from "./categorias/icone";
import { SeletorCategoriaLateral } from "./SeletorCategoriaLateral";

/** Campo "Categoria" dos formulários: mostra a escolha (com o caminho, se for subcategoria) e abre o menu lateral. */
export function CampoCategoria({ categorias, valor, onChange, onCriar, ariaLabel = "Categoria", placeholder = "Sem categoria" }: {
  categorias: CategoriaApi[];
  valor: string | null;
  onChange: (id: string | null) => void;
  onCriar?: (nome: string) => Promise<void>;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const porId = montarHierarquia(categorias).porId;
  const atual = valor ? porId.get(valor) : undefined;
  return (
    <div className="cofre-launch-select">
      <button ref={botao} type="button" aria-haspopup="dialog" aria-label={ariaLabel} aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
        <div style={{ flex: "0 0 24px", width: 24, height: 24, display: "grid", placeItems: "center" }}><CategoriaIcone categoria={atual ?? null} tamanho={13} className="cofre-cats-icon sm" /></div>
        <span>{atual ? caminhoCompleto(atual, porId) : placeholder}</span>
        <ChevronDown size={14} />
      </button>
      <SeletorCategoriaLateral categorias={categorias.filter((c) => !c.arquivada || c.id === valor)} aberto={aberto} onClose={() => setAberto(false)} valor={valor} onChange={onChange} onCriar={onCriar} ancora={botao.current} />
    </div>
  );
}
