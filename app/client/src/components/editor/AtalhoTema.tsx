import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Atalho do menu "⋯" da nota: alterna claro/escuro só enquanto a nota está aberta.
 * Não grava a preferência; ao sair da nota o tema que estava antes volta.
 */
export function AtalhoTema() {
  const original = useRef<string | null>(null);
  const atual = () => document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const [tema, setTema] = useState(atual);

  useEffect(() => () => {
    if (original.current) document.documentElement.setAttribute("data-theme", original.current);
  }, []);

  function alternar() {
    if (original.current === null) original.current = atual();
    const novo = atual() === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", novo);
    setTema(novo);
  }

  const claro = tema === "light";
  return (
    <button type="button" onClick={alternar} className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-border px-3 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary">
      {claro ? <Moon size={16} /> : <Sun size={16} />}
      {claro ? "Modo escuro (só nesta nota)" : "Modo claro (só nesta nota)"}
    </button>
  );
}
