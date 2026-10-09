import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Plus, Search, Tag, X } from "lucide-react";
import type { CategoriaApi } from "@/lib/api";
import { PainelJanelaContext } from "@/lib/documento-popup";
import { montarHierarquia } from "@/lib/categorias-hierarquia";
import { casaBusca } from "@/lib/texto-busca";
import { CategoriaIcone } from "./categorias/icone";
import "./categorias/categorias.css";

export const SEM_CATEGORIA_ID = "__sem_categoria__";
type Visao = "principais" | "todas";
const LARGURA = 440;
/** Campo de texto sem o aspecto nativo (caixa, contorno de foco): inline, para nenhuma regra de formulário vencer. */
const CAMPO_LIMPO: CSSProperties = { outline: "none", boxShadow: "none", border: 0, background: "transparent", padding: 0, borderRadius: 0, appearance: "none", WebkitAppearance: "none" };
const CHAVE_VISAO = "ecos.cofre.seletor-categoria.visao";

function visaoSalva(): Visao {
  try { return localStorage.getItem(CHAVE_VISAO) === "principais" ? "principais" : "todas"; } catch { return "todas"; }
}

interface Comum {
  categorias: CategoriaApi[];
  aberto: boolean;
  onClose: () => void;
  titulo?: string;
  /** Mostra a opção "Sem categoria". */
  permiteSem?: boolean;
  /** Elemento de onde o seletor foi aberto: o painel nasce dentro do formulário dele para herdar as cores. */
  ancora?: HTMLElement | null;
  /** Cria uma categoria nova pelo nome (já devolve a lista atualizada ao chamador). */
  onCriar?: (nome: string) => Promise<void>;
}
type Props = Comum & (
  | { multiplo?: false; valor: string | null; onChange: (id: string | null) => void }
  | { multiplo: true; valor: Set<string>; onChange: (ids: Set<string>) => void }
);

/**
 * Menu lateral de categorias: busca, alternância entre "só categorias" e "com subcategorias" e, no modo múltiplo,
 * caixa de seleção da mãe que marca/desmarca as subcategorias junto.
 */
export function SeletorCategoriaLateral(props: Props) {
  const { categorias, aberto, onClose, titulo = "Categoria", permiteSem = true, ancora, onCriar } = props;
  const [novo, setNovo] = useState("");
  const [criando, setCriando] = useState(false);
  const [busca, setBusca] = useState("");
  const [visao, setVisao] = useState<Visao>(visaoSalva);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const campo = useRef<HTMLInputElement>(null);
  const h = useMemo(() => montarHierarquia(categorias), [categorias]);

  // Dentro da janela do lançamento (desktop) a janela se alarga e o painel vira parte dela, sem emenda. Fora dela
  // (aba, celular, janela sem espaço) o painel sobrepõe à direita.
  const janela = useContext(PainelJanelaContext);
  const [embutido, setEmbutido] = useState(0);
  useLayoutEffect(() => {
    if (!aberto || !janela || window.innerWidth < 900) { setEmbutido(0); return; }
    const concedida = janela.abrir(LARGURA);
    setEmbutido(concedida);
    return () => { if (concedida) janela.fechar(); };
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!aberto) return;
    setBusca("");
    const t = window.setTimeout(() => campo.current?.focus(), embutido ? 380 : 60);
    return () => window.clearTimeout(t);
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!aberto) return null;

  const mostrarSubs = visao === "todas";
  const buscando = busca.trim() !== "";
  const marcado = (id: string) => (props.multiplo ? props.valor.has(id) : props.valor === id);
  const semMarcado = props.multiplo ? props.valor.has(SEM_CATEGORIA_ID) : props.valor === null;

  function escolher(id: string | null) {
    if (props.multiplo) {
      const n = new Set(props.valor);
      const filhas = id ? (h.filhas.get(id) ?? []).map((f) => f.id) : [];
      const todas = [id ?? SEM_CATEGORIA_ID, ...(mostrarSubs ? filhas : [])];
      const ligar = !todas.every((x) => n.has(x));
      for (const x of todas) { if (ligar) n.add(x); else n.delete(x); }
      props.onChange(n);
    } else {
      props.onChange(id);
      onClose();
    }
  }

  function mudarVisao(v: Visao) {
    setVisao(v);
    try { localStorage.setItem(CHAVE_VISAO, v); } catch { /* vale só nesta sessão */ }
  }

  function linha(c: CategoriaApi, filhas: CategoriaApi[], ehFilha: boolean) {
    const parcial = props.multiplo && mostrarSubs && filhas.length > 0 && !marcado(c.id) && filhas.some((f) => marcado(f.id));
    const expandida = buscando || abertas.has(c.id);
    const mae = ehFilha && c.pai_id ? h.porId.get(c.pai_id) : undefined;
    return (
      <li key={c.id} className="cofre-catdrawer-item">
        <div className="cofre-catdrawer-row" data-sub={ehFilha || undefined} data-marcado={marcado(c.id) || undefined}>
          {mostrarSubs && filhas.length > 0 && !buscando
            ? <button type="button" className="cofre-catdrawer-seta" aria-label={`${expandida ? "Recolher" : "Expandir"} ${c.nome}`} aria-expanded={expandida} data-aberta={expandida || undefined} onClick={() => setAbertas((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}><ChevronRight size={14} /></button>
            : <span className="cofre-catdrawer-seta vazio" aria-hidden />}
          <button type="button" className="cofre-catdrawer-escolha" role={props.multiplo ? "checkbox" : "option"} aria-checked={props.multiplo ? (parcial ? "mixed" : marcado(c.id)) : undefined} aria-selected={props.multiplo ? undefined : marcado(c.id)} title={mae ? `${mae.nome} › ${c.nome}` : c.nome} onClick={() => escolher(c.id)}>
            <CategoriaIcone categoria={c} tamanho={13} className="cofre-cats-icon sm" />
            <span className="cofre-catdrawer-nome">{c.nome}</span>
            {mostrarSubs && filhas.length > 0 && <em>{filhas.length} sub</em>}
            <span className="cofre-catdrawer-marca" data-parcial={parcial || undefined}>{(marcado(c.id) || parcial) && <Check size={12} strokeWidth={3} />}</span>
          </button>
        </div>
        {mostrarSubs && filhas.length > 0 && expandida && <ul className="cofre-catdrawer-sub">{filhas.map((f) => linha(f, [], true))}</ul>}
      </li>
    );
  }

  // A busca acha pelo nome da categoria ou da subcategoria; a mãe aparece com as filhas que casaram (todas, se ela mesma casou).
  const filhasDe = (c: CategoriaApi) => {
    const todas = h.filhas.get(c.id) ?? [];
    return buscando && !casaBusca(busca, c.nome) ? todas.filter((f) => casaBusca(busca, f.nome, c.nome)) : todas;
  };
  const raizes = h.raizes.filter((c) => !buscando || casaBusca(busca, c.nome) || (mostrarSubs && filhasDe(c).length > 0));
  const alvo = embutido ? janela?.montagem ?? null : null;
  const destino = alvo ?? (ancora?.closest<HTMLElement>(".cofre-launch-form, .cofre-app") ?? document.querySelector<HTMLElement>(".cofre-app") ?? document.body);
  const painel = (
      <aside className="cofre-catdrawer" data-embutido={alvo ? "true" : undefined} style={alvo ? ({ width: embutido } as CSSProperties) : undefined} role="dialog" aria-modal={alvo ? undefined : true} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} aria-label={`Escolher ${titulo.toLowerCase()}`}>
        <header>
          <span className="cofre-catdrawer-titulo"><Tag size={15} />{titulo}</span>
          {props.multiplo && props.valor.size > 0 && <button type="button" className="cofre-catdrawer-limpar" onClick={() => props.onChange(new Set())}>Limpar ({props.valor.size})</button>}
          <button type="button" className="cofre-cats-iconbtn" aria-label="Fechar" onClick={onClose}><X size={16} /></button>
        </header>
        <label className="cofre-catdrawer-busca"><Search size={14} /><input ref={campo} style={CAMPO_LIMPO} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar categoria ou subcategoria…" aria-label="Buscar categoria" />{busca && <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")}><X size={12} /></button>}</label>
        <div className="cofre-catdrawer-visao" role="group" aria-label="O que listar">
          <button type="button" aria-pressed={visao === "principais"} onClick={() => mudarVisao("principais")}>Categorias</button>
          <button type="button" aria-pressed={visao === "todas"} onClick={() => mudarVisao("todas")}>Com subcategorias</button>
        </div>
        <ul className="cofre-catdrawer-lista" role={props.multiplo ? "group" : "listbox"} aria-label="Categorias">
          {permiteSem && !buscando && (
            <li className="cofre-catdrawer-item">
              <div className="cofre-catdrawer-row" data-marcado={semMarcado || undefined}>
                <span className="cofre-catdrawer-seta vazio" aria-hidden />
                <button type="button" className="cofre-catdrawer-escolha" role={props.multiplo ? "checkbox" : "option"} aria-checked={props.multiplo ? semMarcado : undefined} aria-selected={props.multiplo ? undefined : semMarcado} onClick={() => escolher(null)}>
                  <CategoriaIcone categoria={null} tamanho={13} className="cofre-cats-icon sm" />
                  <span className="cofre-catdrawer-nome">Sem categoria</span>
                  <span className="cofre-catdrawer-marca">{semMarcado && <Check size={12} strokeWidth={3} />}</span>
                </button>
              </div>
            </li>
          )}
          {raizes.map((c) => linha(c, mostrarSubs ? filhasDe(c) : [], false))}
          {raizes.length === 0 && <li className="cofre-catdrawer-vazio">Nenhuma categoria encontrada{buscando ? ` para “${busca.trim()}”` : ""}.</li>}
        </ul>
        {onCriar && (
          <form className="cofre-catdrawer-nova" onSubmit={(e) => { e.preventDefault(); const nome = novo.trim(); if (!nome || criando) return; setCriando(true); onCriar(nome).then(() => { setNovo(""); if (!props.multiplo) onClose(); }).catch(() => {}).finally(() => setCriando(false)); }}>
            <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Nova categoria…" aria-label="Nome da nova categoria" maxLength={40} />
            <button type="submit" disabled={criando || !novo.trim()} aria-label="Criar categoria"><Plus size={14} /></button>
          </form>
        )}
        {props.multiplo && <footer><button type="button" className="cofre-solid" onClick={onClose}>Concluir</button></footer>}
      </aside>
  );

  return createPortal(
    alvo ? painel : (
      <div className="cofre-catdrawer-wrap">
        <div className="cofre-catdrawer-fundo" onClick={onClose} />
        {painel}
      </div>
    ),
    destino,
  );
}
