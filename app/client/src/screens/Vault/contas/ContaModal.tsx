import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Landmark, LayoutGrid, List, Search, Wallet, X } from "lucide-react";
import { SeletorEcos } from "@/components/common/SeletorEcos";
import { vault, ApiError, type ContaApi, type ContaUsoApi, type TipoConta } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { CORES, LixeiraAnimada, corDoTexto } from "../VaultCategories";
import { BANCOS, GRUPOS_BANCO, TIPOS_CONTA, bancoPorCodigo, buscarBancos, type Banco } from "./bancos";
import { SeloConta } from "./SeloConta";
import { SeletorCor } from "./SeletorCor";
import { iniciais as iniciaisDe } from "./bancos";
import { centavosBR, centavosParaCampo } from "./analise";

const PERSONALIZADO = "__personalizado__";
const CHAVE_MODO_BANCOS = "ecos:cofre:bancos-modo";
type ModoBancos = "lista" | "grade";
function lerModoBancos(): ModoBancos {
  try { return localStorage.getItem(CHAVE_MODO_BANCOS) === "grade" ? "grade" : "lista"; } catch { return "lista"; }
}
const COR_PADRAO = "#94a3b8";

export { SeloConta };

export function ContaModal({ conta, contas, onClose, onSaved }: { conta?: ContaApi; contas: ContaApi[]; onClose: () => void; onSaved: (id?: string) => void }) {
  const bancoInicial = conta ? (bancoPorCodigo(conta.codigo_banco) ? conta.codigo_banco! : conta.banco || conta.tipo !== "carteira" ? PERSONALIZADO : "") : "";
  const [escolhido, setEscolhido] = useState<string>(bancoInicial);
  const [busca, setBusca] = useState("");
  const [modoBancos, setModoBancos] = useState<ModoBancos>(lerModoBancos);
  const [bancoNome, setBancoNome] = useState(conta?.banco ?? "");
  const [codigo, setCodigo] = useState(conta?.codigo_banco ?? "");
  const [sigla, setSigla] = useState(conta?.sigla ?? "");
  const [nome, setNome] = useState(conta?.nome ?? "");
  const [nomeEditado, setNomeEditado] = useState(!!conta);
  const [tipo, setTipo] = useState<TipoConta>(conta?.tipo ?? "corrente");
  const [agencia, setAgencia] = useState(conta?.agencia ?? "");
  const [numero, setNumero] = useState(conta?.numero_conta ?? "");
  const [saldo, setSaldo] = useState(centavosParaCampo(conta?.saldo_inicial_centavos ?? 0));
  const [cor, setCor] = useState(conta?.cor ?? COR_PADRAO);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [uso, setUso] = useState<ContaUsoApi | null>(null);
  const [destino, setDestino] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);
  const nomeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lista = useMemo(() => buscarBancos(busca), [busca]);
  const grupos = useMemo(() => (Object.keys(GRUPOS_BANCO) as Banco["grupo"][]).map((g) => ({ g, itens: lista.filter((b) => b.grupo === g) })).filter((x) => x.itens.length), [lista]);
  const saldoCentavos = centavosBR(saldo);

  function trocarModo(m: ModoBancos) {
    setModoBancos(m);
    try { localStorage.setItem(CHAVE_MODO_BANCOS, m); } catch { /* vale só nesta sessão */ }
  }

  function fechar() {
    setSaindo(true);
    window.setTimeout(onClose, 160);
  }

  function escolherBanco(b: Banco) {
    const anterior = bancoPorCodigo(escolhido);
    setEscolhido(b.codigo);
    setBancoNome(b.curto);
    setCodigo(b.codigo);
    setCor(b.cor);
    // O nome acompanha o banco enquanto a pessoa não o editou à mão.
    if (!nomeEditado || nome === anterior?.curto) { setNome(b.curto); setNomeEditado(false); }
    if (tipo === "carteira") setTipo("corrente");
    nomeRef.current?.focus();
  }

  function escolherPersonalizado() {
    setEscolhido(PERSONALIZADO);
    if (bancoPorCodigo(codigo)) { setBancoNome(""); setCodigo(""); }
    if (tipo === "carteira") setTipo("corrente");
  }

  function escolherCarteira() {
    setEscolhido("");
    setBancoNome("");
    setCodigo("");
    setAgencia("");
    setNumero("");
    setTipo("carteira");
    if (!nomeEditado) setNome("Carteira");
  }

  async function salvar() {
    if (!nome.trim()) { setErro("Informe um nome para a conta."); return; }
    if (saldoCentavos === null) { setErro("Saldo inicial inválido. Use o formato 1.234,56 (pode ser negativo)."); return; }
    if (codigo && !/^\d{1,4}$/.test(codigo.trim())) { setErro("O código do banco tem só números (ex.: 260)."); return; }
    if (sigla && !/^[\p{L}\p{N}]{1,4}$/u.test(sigla.trim())) { setErro("A sigla tem até 4 letras ou números."); return; }
    setOcupado(true);
    setErro(null);
    const payload = {
      nome: nome.trim(), tipo, cor,
      banco: bancoNome.trim() || null, codigo_banco: codigo.trim() ? codigo.trim().padStart(3, "0") : null,
      agencia: agencia.trim() || null, numero_conta: numero.trim() || null, saldo_inicial_centavos: saldoCentavos,
      // A sigla só existe no banco personalizado; os do catálogo têm logo ou iniciais próprias.
      sigla: escolhido === PERSONALIZADO && sigla.trim() ? sigla.trim().toUpperCase() : null,
    };
    try {
      if (conta) { await vault.contas.atualizar(conta.id, payload); onSaved(conta.id); }
      else { const r = await vault.contas.criar(payload); onSaved(r.id); }
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
      setOcupado(false);
    }
  }

  async function pedirExclusao() {
    if (!conta) return;
    setOcupado(true);
    setErro(null);
    try {
      const u = await vault.contas.uso(conta.id);
      if (u.transacoes + u.recorrencias === 0) setConfirmando(true);
      else { setDestino(""); setUso(u); }
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível verificar o uso da conta.");
    } finally {
      setOcupado(false);
    }
  }

  async function excluir(decisao?: { mover_para: string } | { sem_conta: true }) {
    if (!conta) return;
    setOcupado(true);
    try {
      await vault.contas.excluir(conta.id, decisao);
      onSaved();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível apagar.");
      setOcupado(false);
    }
  }

  const ehCarteira = tipo === "carteira";
  const personalizado = escolhido === PERSONALIZADO;
  const bancoPronto = bancoPorCodigo(escolhido);

  return (
    <div className="cofre-cats-modal" data-saindo={saindo || undefined}>
      <div className="cofre-cats-backdrop" onClick={fechar} />
      <form className="cofre-card cofre-cats-dialog cofre-contas-dialog" role="dialog" aria-modal="true" aria-label={conta ? "Editar conta" : "Nova conta"} onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
        <header>
          <SeloConta nome={nome.trim() || "?"} cor={cor} tipo={tipo} codigoBanco={codigo || null} sigla={escolhido === PERSONALIZADO ? sigla : null} tamanho="lg" />
          <div><p>{conta ? "EDITAR CONTA" : "NOVA CONTA"}</p><h2>{nome.trim() || "Sem nome"}</h2></div>
          <span className="cofre-cats-header-acoes">
            {conta && (
              <button type="button" className="cofre-cats-iconbtn cofre-cats-lixeira" aria-label="Apagar conta" title="Apagar conta" disabled={ocupado || confirmando || !!uso} onClick={() => void pedirExclusao()}>
                <LixeiraAnimada />
              </button>
            )}
            <button type="button" className="cofre-cats-iconbtn cofre-cats-fechar" aria-label="Fechar" onClick={fechar}><X size={18} /></button>
          </span>
        </header>

        {erro && <p className="cofre-launch-alert" role="alert">{erro}</p>}

        <div className="cofre-contas-corpo">
          <div className="cofre-contas-esq">
        <div className="cofre-cats-field cofre-contas-instituicao">
          <span>Instituição</span>
          <div className="cofre-bancos-busca">
            <label className="cofre-cats-search"><Search size={13} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar banco pelo nome ou número…" aria-label="Buscar banco" />{busca && <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")}><X size={12} /></button>}</label>
            <div className="cofre-bancos-modo" role="group" aria-label="Modo de exibição dos bancos">
              <button type="button" aria-pressed={modoBancos === "lista"} aria-label="Ver bancos em lista" title="Lista" onClick={() => trocarModo("lista")}><List size={15} /></button>
              <button type="button" aria-pressed={modoBancos === "grade"} aria-label="Ver bancos em grade" title="Grade" onClick={() => trocarModo("grade")}><LayoutGrid size={15} /></button>
            </div>
          </div>
          <div className="cofre-bancos" role="listbox" aria-label="Bancos" data-modo={modoBancos}>
            {!busca && (
              <div className="cofre-bancos-grupo cofre-bancos-outras">
                <h5>Outras opções</h5>
                <div>
                  <button type="button" role="option" aria-selected={personalizado} className="cofre-banco" data-ativo={personalizado || undefined} onClick={escolherPersonalizado}>
                    <span className="cofre-banco-selo" style={{ background: "var(--panel-elevated)", color: "var(--text)" }}><Landmark size={14} /></span>
                    <span><b>Outro banco (personalizado)</b><small>Informe nome e número</small></span>
                  </button>
                  <button type="button" role="option" aria-selected={ehCarteira} className="cofre-banco" data-ativo={ehCarteira || undefined} onClick={escolherCarteira}>
                    <span className="cofre-banco-selo" style={{ background: "var(--panel-elevated)", color: "var(--text)" }}><Wallet size={14} /></span>
                    <span><b>Carteira (dinheiro)</b><small>Sem banco</small></span>
                  </button>
                </div>
              </div>
            )}
            {grupos.map(({ g, itens }) => (
              <div key={g} className="cofre-bancos-grupo">
                <h5>{GRUPOS_BANCO[g]}</h5>
                <div>
                  {itens.map((b) => (
                    <button key={b.codigo} type="button" role="option" aria-selected={escolhido === b.codigo} className="cofre-banco" data-ativo={escolhido === b.codigo || undefined} onClick={() => escolherBanco(b)}>
                      <span className="cofre-banco-selo" style={{ background: "none" }}><SeloConta nome={b.curto} cor={b.cor} codigoBanco={b.codigo} tamanho="sm" /></span>
                      <span><b>{b.curto}</b><small>{b.codigo}</small></span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {lista.length === 0 && (
              <p className="cofre-cats-none">Nenhum banco encontrado. <button type="button" className="cofre-link" onClick={() => { setBusca(""); escolherPersonalizado(); }}>Cadastrar banco personalizado</button></p>
            )}
          </div>
          <small className="cofre-bancos-total">{BANCOS.length} instituições no catálogo · o número é o código COMPE do banco</small>
        </div>

          </div>
          <div className="cofre-contas-dir">
        <div className="cofre-contas-banco" data-travado={!personalizado || undefined}>
          <label className="cofre-cats-field"><span>Nome do banco</span><input value={bancoNome} onChange={(e) => setBancoNome(e.target.value)} placeholder={personalizado ? "Ex.: Banco Fulano" : "—"} maxLength={60} disabled={!personalizado} /></label>
          <label className="cofre-cats-field"><span>Número do banco</span><input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder={personalizado ? "Ex.: 001" : "—"} inputMode="numeric" disabled={!personalizado} /></label>
          <label className="cofre-cats-field"><span>Sigla do selo</span><input value={personalizado ? sigla : bancoPronto ? iniciaisDe(bancoPronto.curto) : ""} onChange={(e) => setSigla(e.target.value.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 4).toUpperCase())} placeholder={personalizado ? iniciaisDe(bancoNome || nome) : "—"} maxLength={4} aria-label="Sigla do selo" disabled={!personalizado} /></label>
          {personalizado && <small className="cofre-contas-dica">A sigla (até 4 letras) aparece no selo da conta. Sem sigla, usamos as iniciais do nome.</small>}
        </div>
        <label className="cofre-cats-field"><span>Nome da conta</span><input ref={nomeRef} value={nome} onChange={(e) => { setNome(e.target.value); setNomeEditado(true); }} placeholder="Ex.: Nubank — conta principal" maxLength={60} /></label>

        <div className="cofre-cats-field">
          <span>Tipo</span>
          <div className="cofre-cats-chips" role="group" aria-label="Tipo da conta">
            {TIPOS_CONTA.map((t) => <button key={t.valor} type="button" aria-pressed={tipo === t.valor} onClick={() => setTipo(t.valor)}>{t.rotulo}</button>)}
          </div>
        </div>

        {!ehCarteira && (
          <div className="cofre-launch-grid">
            <label className="cofre-cats-field"><span>Agência</span><input value={agencia} onChange={(e) => setAgencia(e.target.value)} placeholder="0001" maxLength={12} inputMode="numeric" /></label>
            <label className="cofre-cats-field"><span>Número da conta</span><input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="12345-6" maxLength={20} /></label>
          </div>
        )}

        <label className="cofre-cats-field">
          <span>Saldo inicial (R$)</span>
          <input value={saldo} onChange={(e) => setSaldo(e.target.value)} placeholder="0,00" inputMode="text" aria-invalid={saldoCentavos === null || undefined} />
          <small className="cofre-contas-dica">O saldo da conta hoje, antes dos lançamentos que você registrar aqui. Pode ser negativo.</small>
        </label>

        <div className="cofre-cats-field">
          <span>Cor</span>
          <SeletorCor valor={cor} onChange={setCor} />
        </div>
          </div>
        </div>
        {confirmando && conta && (
          <div className="cofre-launch-alert" role="alert">
            <p>Apagar “{conta.nome}”? Nenhum lançamento usa esta conta. Essa ação não pode ser desfeita.</p>
            <div><button type="button" onClick={() => setConfirmando(false)}>Cancelar</button><button type="button" disabled={ocupado} onClick={() => void excluir()}>{ocupado ? "Apagando…" : "Apagar"}</button></div>
          </div>
        )}

        {uso && conta && (
          <section className="cofre-launch-alert cofre-cats-uso" role="alert" aria-label={`Apagar ${conta.nome}`}>
            <p>
              “{conta.nome}” é usada por <b>{uso.transacoes} {uso.transacoes === 1 ? "lançamento" : "lançamentos"}</b>
              {uso.recorrencias > 0 && <>, <b>{uso.recorrencias} {uso.recorrencias === 1 ? "recorrência" : "recorrências"}</b></>}.
              Escolha para onde eles vão antes de apagar. O saldo inicial desta conta some junto com ela.
            </p>
            {uso.amostra.length > 0 && (
              <ul className="cofre-cats-uso-lista" aria-label="Lançamentos desta conta">
                {uso.amostra.map((t) => (
                  <li key={t.id}>
                    <time>{t.data.split("-").reverse().join("/")}</time>
                    <span>{t.descricao}</span>
                    <strong data-tipo={t.tipo}>{t.tipo === "entrada" ? "+" : "−"}{formatMoeda(t.valor_centavos)}</strong>
                  </li>
                ))}
                {uso.transacoes > uso.amostra.length && <li className="cofre-cats-uso-mais">e mais {uso.transacoes - uso.amostra.length} {uso.transacoes - uso.amostra.length === 1 ? "lançamento" : "lançamentos"}</li>}
              </ul>
            )}
            <div className="cofre-cats-field">
              <span>Mover tudo para</span>
              <SeletorEcos ariaLabel="Mover tudo para" classe="min-h-[40px] max-w-full rounded-[11px] border border-[var(--border)] bg-[var(--panel)] px-2.5 text-[13px] text-[var(--text)]" valor={destino} onChange={setDestino} opcoes={[{ valor: "", rotulo: "Sem conta" }, ...contas.filter((c) => c.id !== conta.id).map((c) => ({ valor: c.id, rotulo: c.nome }))]} />
            </div>
            <div>
              <button type="button" onClick={() => setUso(null)} disabled={ocupado}>Cancelar</button>
              <button type="button" disabled={ocupado} onClick={() => void excluir(destino ? { mover_para: destino } : { sem_conta: true })}>
                {ocupado ? "Movendo e apagando…" : destino ? "Mover e apagar" : "Deixar sem conta e apagar"}
              </button>
            </div>
          </section>
        )}

        <footer>
          <button type="button" className="cofre-secondary" onClick={fechar}>Cancelar</button>
          <button type="submit" className="cofre-solid" disabled={ocupado || !nome.trim()}>{ocupado && !confirmando ? "Salvando…" : conta ? "Salvar" : "Criar conta"}</button>
        </footer>
      </form>
    </div>
  );
}

