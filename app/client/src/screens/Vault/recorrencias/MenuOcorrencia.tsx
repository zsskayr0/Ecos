import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, Check, CheckCheck, Copy, Ellipsis, Pause, Pencil, Play, Trash2 } from "lucide-react";

/** Ações que o menu "…" pode oferecer; o que não se aplica à ocorrência vem `undefined` e não aparece. */
export interface AcoesDaOcorrencia {
  /** Ausente dentro do próprio painel de edição. */
  onEditar?: () => void;
  onDuplicar: () => void;
  onConcluir?: () => void;
  onConcluirParcial?: () => void;
  onReagendar?: () => void;
  /** Pausa (ou reativa) a regra inteira. */
  onAlternarAtiva: () => void;
  ativa: boolean;
  /** Só existem quando há uma ocorrência em foco (não ao editar uma regra pausada). */
  onExcluirEsta?: () => void;
  onExcluirEstaEProximas?: () => void;
  onExcluirTodas: () => void;
}

const ALTURA_ESTIMADA = 360;
// O menu vai para um portal: as linhas têm animação com `transform`, que viraria o referencial do `position: fixed`.

export function MenuOcorrencia({ acoes, rotulo }: { acoes: AcoesDaOcorrencia; rotulo: string }) {
  const [aberto, setAberto] = useState(false);
  const [estilo, setEstilo] = useState<CSSProperties>();
  const gatilho = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  function abrir() {
    const r = gatilho.current!.getBoundingClientRect();
    const sobe = window.innerHeight - r.bottom < ALTURA_ESTIMADA && r.top > window.innerHeight - r.bottom;
    setEstilo({
      position: "fixed",
      right: Math.max(8, window.innerWidth - r.right),
      top: sobe ? "auto" : r.bottom + 6,
      bottom: sobe ? window.innerHeight - r.top + 6 : "auto",
      maxHeight: Math.max(160, (sobe ? r.top : window.innerHeight - r.bottom) - 16),
    });
    setAberto(true);
  }

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !gatilho.current?.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { setAberto(false); gatilho.current?.focus(); } };
    const fechar = () => setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    window.addEventListener("resize", fechar);
    window.addEventListener("scroll", fechar, true);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", fechar);
      window.removeEventListener("scroll", fechar, true);
    };
  }, [aberto]);

  const rodar = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); setAberto(false); fn(); };
  const { onEditar, onConcluir, onConcluirParcial, onReagendar } = acoes;

  return (
    <div className="cofre-rec-menu-wrap" onClick={(e) => e.stopPropagation()}>
      <button ref={gatilho} type="button" className="cofre-rec-mais" aria-label={`Mais ações: ${rotulo}`} aria-haspopup="menu" aria-expanded={aberto}
        onClick={() => (aberto ? setAberto(false) : abrir())}>
        <Ellipsis size={15} />
      </button>
      {aberto && createPortal(
        <div ref={menu} role="menu" aria-label={`Ações de ${rotulo}`} className="cofre-card cofre-rec-menu" style={estilo}>
          {onEditar && <Item icone={<Pencil size={13} />} onClick={rodar(onEditar)}>Editar recorrência</Item>}
          <Item icone={<Copy size={13} />} onClick={rodar(acoes.onDuplicar)}>Duplicar</Item>
          {(onConcluir || onConcluirParcial || onReagendar) && <hr />}
          {onConcluir && <Item icone={<Check size={13} strokeWidth={2.6} />} onClick={rodar(onConcluir)}>Concluir</Item>}
          {onConcluirParcial && <Item icone={<CheckCheck size={13} />} onClick={rodar(onConcluirParcial)}>Concluir parcialmente</Item>}
          {onReagendar && <Item icone={<CalendarClock size={13} />} onClick={rodar(onReagendar)}>Reagendar</Item>}
          <hr />
          <Item icone={acoes.ativa ? <Pause size={13} /> : <Play size={13} />} onClick={rodar(acoes.onAlternarAtiva)}>{acoes.ativa ? "Pausar recorrência" : "Reativar recorrência"}</Item>
          <hr />
          {acoes.onExcluirEsta && <Item perigo icone={<Trash2 size={13} />} onClick={rodar(acoes.onExcluirEsta)}>Excluir só esta data</Item>}
          {acoes.onExcluirEstaEProximas && <Item perigo icone={<Trash2 size={13} />} onClick={rodar(acoes.onExcluirEstaEProximas)}>Excluir esta e as próximas</Item>}
          <Item perigo icone={<Trash2 size={13} />} onClick={rodar(acoes.onExcluirTodas)}>Excluir toda a recorrência</Item>
        </div>,
        gatilho.current?.closest(".cofre-app") ?? document.body,
      )}
    </div>
  );
}

function Item({ icone, perigo, onClick, children }: { icone: ReactNode; perigo?: boolean; onClick: (e: React.MouseEvent) => void; children: ReactNode }) {
  return <button type="button" role="menuitem" data-perigo={perigo || undefined} onClick={onClick}>{icone}<span>{children}</span></button>;
}
