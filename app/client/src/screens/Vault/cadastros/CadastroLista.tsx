import { useId, type ReactNode } from "react";
import { CloudOff, RefreshCw, Search, X } from "lucide-react";

/** Busca da lista; `data-cadastros-busca` deixa a tecla "/" achar o campo. */
export function CampoBusca({ valor, aoMudar, rotulo }: { valor: string; aoMudar: (v: string) => void; rotulo: string }) {
  return (
    <label className="cofre-cats-search cad-busca">
      <Search size={13} aria-hidden />
      <input data-cadastros-busca type="search" value={valor} onChange={(e) => aoMudar(e.target.value)} placeholder={`${rotulo}…`} aria-label={rotulo} />
      {valor && <button type="button" aria-label="Limpar busca" onClick={() => aoMudar("")}><X size={12} /></button>}
    </label>
  );
}

/** Esqueleto de linhas enquanto a lista carrega. */
export function Esqueleto({ linhas = 5, rotulo = "Carregando" }: { linhas?: number; rotulo?: string }) {
  return (
    <div className="cofre-card cad-lista" role="status" aria-label={rotulo}>
      {Array.from({ length: linhas }, (_, i) => <div key={i} className="cad-linha cad-esqueleto" style={{ ["--i" as string]: i }}><i /><span /><span /></div>)}
    </div>
  );
}

export function ErroLista({ mensagem, aoTentar }: { mensagem: string; aoTentar: () => void }) {
  return (
    <div role="alert" className="cofre-card cofre-cats-empty">
      <CloudOff size={28} aria-hidden />
      <p>{mensagem}</p>
      <button type="button" className="cofre-solid" onClick={aoTentar}><RefreshCw size={14} aria-hidden />Tentar novamente</button>
    </div>
  );
}

export function Vazio({ icone, titulo, texto, acao }: { icone: ReactNode; titulo: string; texto?: string; acao?: ReactNode }) {
  return (
    <div className="cofre-card cofre-cats-empty">
      {icone}
      <p>{titulo}</p>
      {texto && <small>{texto}</small>}
      {acao}
    </div>
  );
}

/** Cabeçalho da lista: título, contagem e, opcionalmente, um link para a tela de análise. */
export function CabecalhoLista({ titulo, contagem, children }: { titulo: string; contagem: string; children?: ReactNode }) {
  const id = useId();
  return (
    <div className="cad-cabecalho">
      <div><h2 id={id}>{titulo}</h2><span>{contagem}</span></div>
      {children}
    </div>
  );
}
