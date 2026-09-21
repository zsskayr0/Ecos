import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

interface Props {
  valor: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  /** Nome acessível do botão e do campo. */
  rotulo?: string;
}

/**
 * Lupa que vira barra de pesquisa. Fechada é um botão do tamanho dos chips da barra de filtros (ao passar o mouse a
 * lupa balança e uma onda sai dela); ao clicar, a caixa se estende para a direita e o campo aparece já com foco.
 * O texto é controlado por quem usa (a busca faz parte dos filtros da lista). Enquanto houver texto a barra fica aberta.
 *
 * - Esc: primeiro apaga o texto; com o campo vazio, recolhe.
 * - Sair do campo vazio recolhe; sair com texto mantém aberta (a busca está valendo).
 */
export function BuscaExpansivel({ valor, onChange, placeholder = "Pesquisar…", rotulo = "Pesquisar" }: Props) {
  const [aberta, setAberta] = useState(valor !== "");
  const campo = useRef<HTMLInputElement>(null);
  const ativa = valor.trim() !== "";
  const expandida = aberta || valor !== "";

  // "Limpar" da barra de filtros apaga o texto por fora: recolhe, a menos que a pessoa esteja digitando aqui.
  useEffect(() => {
    if (valor === "" && document.activeElement !== campo.current) setAberta(false);
  }, [valor]);

  function alternar() {
    if (!expandida) {
      setAberta(true);
      // O campo ainda não tem largura no primeiro quadro: o foco vem no seguinte, para o cursor nascer no lugar certo.
      requestAnimationFrame(() => campo.current?.focus({ preventScroll: true }));
    } else if (!ativa) {
      setAberta(false);
      campo.current?.blur();
    } else {
      campo.current?.focus({ preventScroll: true });
    }
  }

  function limpar() {
    onChange("");
    campo.current?.focus({ preventScroll: true });
  }

  const cor = ativa ? "border-cyan/60 bg-surface-1 text-text-primary" : expandida ? "border-steel-400/70 bg-surface-1 text-text-primary" : "border-border bg-surface-2 text-text-secondary hover:border-steel-400/60 hover:text-text-primary";

  return (
    <div role="search" data-aberta={expandida} className={`ecos-busca border focus-within:border-steel-400 focus-within:ring-2 focus-within:ring-steel-400/25 ${cor}`}>
      <button
        type="button"
        aria-label={rotulo}
        aria-expanded={expandida}
        // Sem isso o clique tira o foco do campo antes de chegar aqui e o botão reabriria o que acabou de recolher.
        onMouseDown={(e) => e.preventDefault()}
        onClick={alternar}
        className="ecos-busca-lupa transition-transform active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"
      >
        <Search size={14} className={`ecos-busca-icone ${ativa ? "text-cyan" : ""}`} aria-hidden />
      </button>
      <input
        ref={campo}
        type="text"
        role="searchbox"
        aria-label={rotulo}
        autoComplete="off"
        spellCheck={false}
        value={valor}
        placeholder={placeholder}
        tabIndex={expandida ? 0 : -1}
        aria-hidden={!expandida}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { if (!ativa) setAberta(false); }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          if (valor) onChange("");
          else { setAberta(false); campo.current?.blur(); }
        }}
        className="ecos-busca-campo h-full w-full bg-transparent pr-1 text-xs text-text-primary outline-none placeholder:text-text-muted"
      />
      <button
        type="button"
        aria-label="Limpar pesquisa"
        data-visivel={ativa}
        tabIndex={ativa ? 0 : -1}
        disabled={!ativa}
        onMouseDown={(e) => e.preventDefault()}
        onClick={limpar}
        className="ecos-busca-limpar mr-1.5 flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary"
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}
