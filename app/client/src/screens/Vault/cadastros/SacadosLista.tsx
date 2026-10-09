import { useMemo, useRef, useState } from "react";
import { Plus, Users, X } from "lucide-react";
import { ApiError, vault, type BeneficiarioApi } from "@/lib/api";
import { casaBusca } from "@/lib/texto-busca";
import { avisar } from "@/lib/toast";
import { CabecalhoLista, CampoBusca, ErroLista, Esqueleto, Vazio } from "./CadastroLista";
import { resultadoIndeterminado, useModalFoco } from "./useModalFoco";

export interface DadosSacados { sacados: BeneficiarioApi[] | null; erro: string | null; recarregar: () => Promise<BeneficiarioApi[] | null> }

export function SacadosLista({ dados, aoEditar, aoNovo }: { dados: DadosSacados; aoEditar: (s: BeneficiarioApi) => void; aoNovo: () => void }) {
  const [busca, setBusca] = useState("");
  const visiveis = useMemo(() => (dados.sacados ?? []).filter((s) => casaBusca(busca, s.nome)), [dados.sacados, busca]);
  if (dados.erro && !dados.sacados) return <ErroLista mensagem={dados.erro} aoTentar={() => void dados.recarregar()} />;
  if (!dados.sacados) return <Esqueleto rotulo="Carregando sacados" />;
  return (
    <section aria-label="Sacados">
      <CabecalhoLista titulo="Sacados" contagem={`${dados.sacados.length} cadastrados`}>
        <CampoBusca valor={busca} aoMudar={setBusca} rotulo="Buscar sacado" />
      </CabecalhoLista>
      {visiveis.length === 0 ? (
        <Vazio icone={<Users size={30} aria-hidden />} titulo={busca ? "Nenhum sacado encontrado" : "Nenhum sacado cadastrado"} texto={busca ? "Tente outro nome." : "Sacados também são criados sozinhos quando você informa o pagador ou recebedor de um lançamento."}
          acao={<button type="button" className="cofre-solid" onClick={aoNovo}><Plus size={14} aria-hidden />Novo sacado</button>} />
      ) : (
        <ul className="cofre-card cad-lista">
          {visiveis.map((s) => (
            <li key={s.id} className="cad-linha">
              <button type="button" className="cad-linha-principal" aria-label={`Renomear ${s.nome}`} onClick={() => aoEditar(s)}>
                <span className="cofre-cats-icon" aria-hidden><Users size={15} /></span>
                <span className="cad-linha-texto">
                  <span className="cad-linha-nome"><b>{s.nome}</b></span>
                  <small>{s.transacoes === undefined ? "—" : s.transacoes === 0 ? "Sem lançamentos" : `${s.transacoes} ${s.transacoes === 1 ? "lançamento" : "lançamentos"}`}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Criar (find-or-create por nome) ou renomear um sacado. Mesclar duplicados fica na tela Sacados. */
export function SacadoModal({ sacado, dados, aoFechar, aoConciliar }: {
  sacado?: BeneficiarioApi;
  dados: DadosSacados;
  aoFechar: () => void;
  /** Leva para a tela Sacados (conciliar e mesclar). */
  aoConciliar: () => void;
}) {
  const [nome, setNome] = useState(sacado?.nome ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** Nome já usado por outro cadastro (409): o texto digitado fica e a saída é conciliar. */
  const [conflito, setConflito] = useState(false);
  const [jaExiste, setJaExiste] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);
  const dialogo = useRef<HTMLFormElement>(null);
  function fechar() { setSaindo(true); window.setTimeout(aoFechar, 160); }
  useModalFoco(dialogo, fechar);

  async function salvar() {
    const limpo = nome.trim();
    if (!limpo) { setErro("Informe o nome do sacado."); return; }
    setOcupado(true); setErro(null); setConflito(false); setJaExiste(null);
    try {
      if (sacado) {
        if (limpo === sacado.nome) { aoFechar(); return; }
        await vault.beneficiarios.renomear(sacado.id, limpo);
        await dados.recarregar();
        avisar("Sacado renomeado.", "sucesso");
        aoFechar();
      } else {
        const r = await vault.beneficiarios.criarOuEncontrar({ nome: limpo });
        await dados.recarregar();
        if (!r.novo) { setJaExiste(r.nome); setOcupado(false); return; }
        avisar("Sacado criado.", "sucesso");
        aoFechar();
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { setConflito(true); setOcupado(false); return; }
      if (e instanceof ApiError && e.status === 403) { setErro("Você não tem permissão para alterar sacados."); setOcupado(false); return; }
      if (resultadoIndeterminado(e)) {
        const lista = await dados.recarregar();
        const confirmado = lista?.some((s) => (sacado ? s.id === sacado.id : true) && s.nome === limpo);
        if (confirmado) { avisar(sacado ? "Sacado renomeado." : "Sacado salvo.", "sucesso"); aoFechar(); return; }
        setErro("Não deu para confirmar se foi salvo. Seu texto continua aqui: tente de novo.");
        setOcupado(false);
        return;
      }
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
      setOcupado(false);
    }
  }

  return (
    <div className="cofre-cats-modal" data-saindo={saindo || undefined}>
      <div className="cofre-cats-backdrop" onClick={fechar} />
      <form ref={dialogo} className="cofre-card cofre-cats-dialog" role="dialog" aria-modal="true" aria-label={sacado ? "Renomear sacado" : "Novo sacado"} onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
        <header>
          <span className="cofre-cats-icon lg" aria-hidden><Users size={18} /></span>
          <div><p>{sacado ? "RENOMEAR SACADO" : "NOVO SACADO"}</p><h2>{nome.trim() || "Sem nome"}</h2></div>
          <button type="button" aria-label="Fechar" onClick={fechar}><X size={18} /></button>
        </header>
        {erro && <p className="cofre-launch-alert" role="alert">{erro}</p>}
        {jaExiste && <p className="cofre-launch-alert" role="status">Este sacado já está cadastrado: “{jaExiste}”.</p>}
        {conflito && (
          <div className="cofre-launch-alert" role="alert">
            <p>Já existe outro sacado com este nome. Seu texto foi mantido. Se são a mesma pessoa ou empresa, junte os cadastros.</p>
            <div><button type="button" onClick={aoConciliar}>Conciliar e mesclar</button></div>
          </div>
        )}
        <label className="cofre-cats-field">
          <span>Nome</span>
          <input autoFocus value={nome} onChange={(e) => { setNome(e.target.value); setConflito(false); setJaExiste(null); }} placeholder="Ex.: Mercado Extra Ltda" maxLength={120} aria-invalid={conflito || undefined} />
        </label>
        <footer>
          <button type="button" className="cofre-secondary" onClick={fechar}>{jaExiste ? "Fechar" : "Cancelar"}</button>
          <button type="submit" className="cofre-solid" disabled={ocupado || !nome.trim()}>{ocupado ? "Salvando…" : sacado ? "Renomear" : "Criar sacado"}</button>
        </footer>
      </form>
    </div>
  );
}
