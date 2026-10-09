import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Keyboard, Plus } from "lucide-react";
import { ApiError, vault, type BeneficiarioApi, type ContaApi, type FormaPagamentoApi } from "@/lib/api";
import { avisar } from "@/lib/toast";
import { ContaModal, type BancoPreSelecionado } from "../contas/ContaModal";
import { BancosLista, ContasLista, type DadosContas } from "./ContasBancosListas";
import { FormaPagamentoModal } from "./FormaPagamentoModal";
import { FormasPagamentoLista } from "./FormasPagamentoLista";
import { SacadoModal, SacadosLista, type DadosSacados } from "./SacadosLista";
import "./cadastros.css";

const ABAS = [
  { id: "contas", nome: "Contas", novo: "Nova conta", analise: { rota: "/cofre/contas", rotulo: "Ver análise de contas" } },
  { id: "bancos", nome: "Bancos", novo: "Adicionar conta", analise: { rota: "/cofre/contas", rotulo: "Ver análise de contas" } },
  { id: "sacados", nome: "Sacados", novo: "Novo sacado", analise: { rota: "/cofre/sacados", rotulo: "Ver análise de sacados" } },
  { id: "formas", nome: "Formas de pagamento", novo: "Nova forma", analise: null },
] as const;
type IdAba = (typeof ABAS)[number]["id"];
const CHAVE_ATALHOS = "ecos:cofre:cadastros-atalhos";

type ModalAberto =
  | { tipo: "conta"; conta?: ContaApi; banco?: BancoPreSelecionado }
  | { tipo: "sacado"; sacado?: BeneficiarioApi }
  | { tipo: "forma"; forma?: FormaPagamentoApi };

function lerAtalhos(): boolean {
  try { return localStorage.getItem(CHAVE_ATALHOS) !== "0"; } catch { return true; }
}

/** Carrega uma lista da API com erro tratado e recarga sob demanda; a última lista boa fica na tela se uma recarga falhar. */
function useLista<T>(carregar: () => Promise<T[]>, mensagem: string) {
  const [lista, setLista] = useState<T[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const recarregar = useCallback(async () => {
    try {
      const nova = await carregar();
      if (vivo.current) { setLista(nova); setErro(null); }
      return nova;
    } catch (e) {
      if (vivo.current) setErro(e instanceof ApiError ? e.message : mensagem);
      return null;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void recarregar(); }, [recarregar]);
  return { lista, erro, recarregar };
}

/** Em campo de texto, lista suspensa ou diálogo as teclas de atalho não valem. */
function digitando(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest("[role=dialog],[role=listbox],[role=menu]");
}

export function VaultCadastros({ atualizar }: { atualizar: () => void }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const pedida = params.get("aba");
  const aba: IdAba = ABAS.some((a) => a.id === pedida) ? (pedida as IdAba) : "contas";
  const [modal, setModal] = useState<ModalAberto | null>(null);
  const [atalhos, setAtalhos] = useState(lerAtalhos);
  const contasApi = useLista(() => vault.contas.listar(), "Não foi possível carregar as contas.");
  const sacadosApi = useLista(() => vault.beneficiarios.listar(), "Não foi possível carregar os sacados.");
  const dadosContas: DadosContas = { contas: contasApi.lista, erro: contasApi.erro, recarregar: () => void contasApi.recarregar() };
  const dadosSacados: DadosSacados = { sacados: sacadosApi.lista, erro: sacadosApi.erro, recarregar: sacadosApi.recarregar };
  const abaAtual = ABAS.find((a) => a.id === aba)!;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const novo = useCallback(() => {
    if (aba === "formas") setModal({ tipo: "forma" });
    else if (aba === "sacados") setModal({ tipo: "sacado" });
    else setModal({ tipo: "conta" });
  }, [aba]);

  function trocarAba(id: IdAba, foco = false) {
    setParams({ aba: id }, { replace: true });
    if (foco) window.setTimeout(() => refs.current[id]?.focus(), 0);
  }
  function teclaAba(e: KeyboardEvent, i: number) {
    const passo = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (passo) { e.preventDefault(); trocarAba(ABAS[(i + passo + ABAS.length) % ABAS.length]!.id, true); }
    else if (e.key === "Home") { e.preventDefault(); trocarAba(ABAS[0].id, true); }
    else if (e.key === "End") { e.preventDefault(); trocarAba(ABAS[ABAS.length - 1]!.id, true); }
  }

  // "N" cria e "/" busca, só fora de campos e diálogos, sem modificadores, e só se a pessoa não desligou os atalhos.
  useEffect(() => {
    if (!atalhos || modal) return;
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || digitando(e.target)) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); novo(); }
      else if (e.key === "/") { const campo = document.querySelector<HTMLInputElement>("[data-cadastros-busca]"); if (campo) { e.preventDefault(); campo.focus(); } }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [atalhos, modal, novo]);

  function alternarAtalhos() {
    setAtalhos((v) => { const n = !v; try { localStorage.setItem(CHAVE_ATALHOS, n ? "1" : "0"); } catch { /* vale só nesta sessão */ } return n; });
  }

  async function contaSalva() {
    setModal(null);
    await contasApi.recarregar();
    atualizar();
    avisar("Conta salva.", "sucesso");
  }

  return (
    <section className="cofre-cats cad">
      <div className="cofre-cats-top cofre-rise">
        <div><h1>Cadastros</h1><p className="cad-sub">Contas, bancos, sacados e formas de pagamento em um só lugar.</p></div>
        <div className="cofre-cats-actions">
          <button type="button" className="cad-atalhos" aria-pressed={atalhos} title={atalhos ? "Atalhos ligados: N cria, / busca. Clique para desligar." : "Atalhos desligados. Clique para ligar."} onClick={alternarAtalhos}><Keyboard size={14} aria-hidden />Atalhos {atalhos ? "ligados" : "desligados"}</button>
          {abaAtual.analise && <button type="button" className="cofre-secondary cad-link" onClick={() => navigate(abaAtual.analise!.rota)}>{abaAtual.analise.rotulo}<ArrowUpRight size={13} aria-hidden /></button>}
          <button type="button" className="cofre-new-button" onClick={novo}><Plus size={14} aria-hidden />{abaAtual.novo}</button>
        </div>
      </div>

      <div className="cad-abas" role="tablist" aria-label="Tipo de cadastro">
        {ABAS.map((a, i) => (
          <button key={a.id} ref={(el) => { refs.current[a.id] = el; }} type="button" role="tab" id={`cad-aba-${a.id}`} aria-selected={aba === a.id} aria-controls={`cad-painel-${a.id}`} tabIndex={aba === a.id ? 0 : -1}
            onClick={() => trocarAba(a.id)} onKeyDown={(e) => teclaAba(e, i)}>{a.nome}</button>
        ))}
      </div>

      <div role="tabpanel" id={`cad-painel-${aba}`} aria-labelledby={`cad-aba-${aba}`} className="cad-painel">
        {aba === "contas" && <ContasLista dados={dadosContas} aoEditar={(conta) => setModal({ tipo: "conta", conta })} aoNovo={() => setModal({ tipo: "conta" })} />}
        {aba === "bancos" && <BancosLista dados={dadosContas} aoEditar={(conta) => setModal({ tipo: "conta", conta })} aoNovaConta={(banco) => setModal({ tipo: "conta", banco })} />}
        {aba === "sacados" && <SacadosLista dados={dadosSacados} aoEditar={(sacado) => setModal({ tipo: "sacado", sacado })} aoNovo={() => setModal({ tipo: "sacado" })} />}
        {aba === "formas" && <FormasPagamentoLista aoEditar={(forma) => setModal({ tipo: "forma", forma })} aoNovo={() => setModal({ tipo: "forma" })} />}
      </div>

      {modal?.tipo === "conta" && <ContaModal conta={modal.conta} banco={modal.banco} contas={contasApi.lista ?? []} onClose={() => setModal(null)} onSaved={() => void contaSalva()} />}
      {modal?.tipo === "sacado" && <SacadoModal sacado={modal.sacado} dados={dadosSacados} aoFechar={() => { setModal(null); atualizar(); }} aoConciliar={() => { setModal(null); navigate("/cofre/sacados"); }} />}
      {modal?.tipo === "forma" && <FormaPagamentoModal forma={modal.forma} aoFechar={() => setModal(null)} aoMudarDados={atualizar} />}
    </section>
  );
}
