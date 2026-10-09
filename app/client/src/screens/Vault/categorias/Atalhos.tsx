import { useEffect, useRef, useState } from "react";
import { Keyboard, X } from "lucide-react";

export const ATALHOS: { teclas: string; acao: string }[] = [
  { teclas: "/", acao: "Buscar categoria" },
  { teclas: "N", acao: "Nova categoria" },
  { teclas: "1 – 6", acao: "Grade, Lista, Tabela, Kanban, Mapa e Nuvem" },
  { teclas: "S", acao: "Mostrar ou esconder subcategorias" },
  { teclas: "A", acao: "Mostrar ou esconder arquivadas" },
  { teclas: "D", acao: "Revisar categorias parecidas" },
  { teclas: "I", acao: "Modelos, importar e exportar" },
  { teclas: "Ctrl + A", acao: "Selecionar tudo que está visível" },
  { teclas: "Esc", acao: "Fechar painel ou limpar a seleção" },
  { teclas: "?", acao: "Mostrar esta ajuda" },
];

const digitando = (alvo: EventTarget | null) => {
  const el = alvo as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
};

/** Atalhos de uma tecla da tela de Categorias. Não disparam enquanto se digita, com modificadores (exceto Ctrl+A) ou com um painel aberto. */
export function useAtalhos(mapa: Record<string, () => void>, ativo: boolean) {
  const ref = useRef(mapa);
  ref.current = mapa;
  useEffect(() => {
    if (!ativo) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (digitando(e.target) || e.altKey || e.defaultPrevented) return;
      const tecla = (e.ctrlKey || e.metaKey ? `Ctrl+${e.key}` : e.key).toLowerCase();
      if ((e.ctrlKey || e.metaKey) && tecla !== "ctrl+a") return;
      const acao = ref.current[tecla];
      if (acao) { e.preventDefault(); acao(); }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [ativo]);
}

export function AtalhosAjuda({ onClose }: { onClose: () => void }) {
  const [saindo, setSaindo] = useState(false);
  const fechar = () => { setSaindo(true); window.setTimeout(onClose, 160); };
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "?") { e.preventDefault(); fechar(); } };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cofre-cats-modal" data-saindo={saindo || undefined}>
      <div className="cofre-cats-backdrop" onClick={fechar} />
      <section className="cofre-card cofre-cats-dialog cofre-atalhos" role="dialog" aria-modal="true" aria-label="Atalhos de teclado">
        <header>
          <span className="cofre-cats-icon lg" style={{ background: "var(--panel-elevated)", color: "var(--text)" }}><Keyboard size={18} /></span>
          <div><p>TECLADO</p><h2>Atalhos de Categorias</h2></div>
          <button type="button" className="cofre-cats-iconbtn cofre-cats-fechar" aria-label="Fechar" onClick={fechar}><X size={18} /></button>
        </header>
        <dl className="cofre-atalhos-lista">
          {ATALHOS.map((a) => <div key={a.teclas}><dt>{a.teclas.split(" ").map((t, i) => (t === "+" || t === "–" ? <span key={i}>{t}</span> : <kbd key={i}>{t}</kbd>))}</dt><dd>{a.acao}</dd></div>)}
        </dl>
      </section>
    </div>
  );
}
