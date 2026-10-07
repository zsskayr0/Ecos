import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { SeloConta } from "../contas/SeloConta";
import { Copy, X } from "lucide-react";
import { DatePicker } from "@/components/common/DatePicker";
import { SegmentedSlide } from "@/components/common/SegmentedSlide";
import { MenuSelecao } from "@/screens/Create/TransactionForm";
import { financeiro, FORMAS_PAGAMENTO, vault, type BeneficiarioApi, type CategoriaApi, type ContaApi, type RecorrenciaApi, type RecorrenciaPayload } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { EscopoEdicaoModal, type EscopoEdicao } from "./Dialogos";
import { MenuOcorrencia, type AcoesDaOcorrencia } from "./MenuOcorrencia";
import { centavosDoCampo, centavosParaCampo, dataExibida, type LinhaRecorrencia } from "./ocorrencias";

const ROTULO_FORMA: Record<string, string> = { pix: "Pix", pix_automatico: "Pix Automático", ted: "TED", cartao: "Cartão", dinheiro: "Dinheiro", boleto: "Boleto", outro: "Outro" };
const FREQUENCIAS = [{ valor: "semanal", rotulo: "Semanal" }, { valor: "mensal", rotulo: "Mensal" }, { valor: "anual", rotulo: "Anual" }] as const;

interface Props {
  /** Ausente: criando uma nova. */
  regra?: RecorrenciaApi;
  /** Criando uma nova a partir de outra (duplicar): valores iniciais. */
  modelo?: RecorrenciaApi;
  categorias: CategoriaApi[];
  contas: ContaApi[];
  beneficiarios: BeneficiarioApi[];
  /** Início sugerido para uma recorrência nova. */
  inicioPadrao: string;
  /** Painel fixo ao lado da lista, em vez de janela por cima. */
  fixo?: boolean;
  /** Menu "…" do cabeçalho (só na edição). */
  acoes?: AcoesDaOcorrencia;
  /** Ocorrência aberta: ao salvar, pergunta se vale só para ela, para as próximas ou para todas. */
  linha?: LinhaRecorrencia;
  /** Texto curto de contexto, ex.: "Parcela 3/12 · 10/11/2026". */
  contexto?: string;
  onClose: () => void;
  onSalvo: () => void;
}

export function RecorrenciaModal({ regra, modelo, categorias, contas, beneficiarios, inicioPadrao, fixo = false, acoes, linha, contexto, onClose, onSalvo }: Props) {
  const editando = !!regra;
  const base = regra ?? modelo;
  const [tipo, setTipo] = useState<"entrada" | "saida">(base?.tipo ?? "saida");
  const [descricao, setDescricao] = useState(base?.descricao ?? "");
  const [valor, setValor] = useState(base ? centavosParaCampo(base.valor_centavos) : "");
  const [categoriaId, setCategoriaId] = useState(base?.categoria_id ?? "");
  const [beneficiario, setBeneficiario] = useState(() => beneficiarios.find((b) => b.id === base?.beneficiario_id)?.nome ?? "");
  const [contaId, setContaId] = useState(base?.conta_id ?? (base ? "" : contas.find((c) => c.padrao)?.id ?? ""));
  const [forma, setForma] = useState(base?.forma_pagamento ?? "");
  const [parcelada, setParcelada] = useState(base?.tipo_recorrencia === "parcelada");
  const [frequencia, setFrequencia] = useState<RecorrenciaPayload["frequencia"]>(base?.frequencia ?? "mensal");
  const [intervalo, setIntervalo] = useState(String(base?.intervalo ?? 1));
  const [diaVencimento, setDiaVencimento] = useState(base?.dia_vencimento ? String(base.dia_vencimento) : "");
  const [inicio, setInicio] = useState(base?.data_inicio ?? inicioPadrao);
  const [fim, setFim] = useState(base?.data_fim ?? "");
  const [parcelas, setParcelas] = useState(base?.total_parcelas ? String(base.total_parcelas) : "12");
  const [observacoes, setObservacoes] = useState(base?.observacoes ?? "");
  const [ativa, setAtiva] = useState(base?.ativa ?? true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhendo, setEscolhendo] = useState<{ payload: RecorrenciaPayload; beneficiarioId: string | null } | null>(null);

  useEffect(() => {
    if (fixo) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) onClose(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [fixo, ocupado, onClose]);

  // Depois que a série gerou lançamentos, mudar o início ou o tipo bagunçaria o que já foi lançado.
  const travada = !!regra && regra.parcelas_geradas > 0;
  const centavos = centavosDoCampo(valor);
  const opcoesCategoria = useMemo(() => categorias.filter((c) => c.tipo === tipo || c.tipo === "ambos").map((c) => ({ value: c.id, label: c.nome, cor: c.cor, icone: c.icone })), [categorias, tipo]);
  const opcoesConta = useMemo(() => contas.map((c) => ({ value: c.id, label: c.nome, cor: c.cor, selo: <SeloConta nome={c.nome} cor={c.cor} tipo={c.tipo} codigoBanco={c.codigo_banco} sigla={c.sigla} tamanho="xs" /> })), [contas]);
  const opcoesForma = useMemo(() => FORMAS_PAGAMENTO.map((f) => ({ value: f, label: ROTULO_FORMA[f] ?? f })), []);
  const opcoesFrequencia = FREQUENCIAS.map((f) => ({ value: f.valor, label: f.rotulo }));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!descricao.trim()) return setErro("Informe uma descrição.");
    if (centavos === null) return setErro("Informe um valor válido, como 59,90.");
    if (!inicio) return setErro("Informe a data de início.");
    const total = Number(parcelas);
    if (parcelada && (!Number.isInteger(total) || total < 1)) return setErro("Informe o número de parcelas.");
    const passo = Number(intervalo);
    if (!Number.isInteger(passo) || passo < 1) return setErro("“A cada” precisa ser um número inteiro de 1 em diante.");
    const dia = diaVencimento ? Number(diaVencimento) : null;
    if (dia !== null && (!Number.isInteger(dia) || dia < 1 || dia > 31)) return setErro("O dia de vencimento vai de 1 a 31.");
    if (!parcelada && fim && fim < inicio) return setErro("O encerramento não pode ser antes do início.");

    setOcupado(true);
    try {
      const nome = beneficiario.trim();
      const beneficiarioId = nome ? (await vault.beneficiarios.criarOuEncontrar({ nome })).id : null;
      const payload: RecorrenciaPayload = {
        tipo, descricao: descricao.trim(), valor_centavos: centavos,
        categoria_id: categoriaId || null, conta_id: contaId || null, beneficiario_id: beneficiarioId, forma_pagamento: forma || null,
        tipo_recorrencia: parcelada ? "parcelada" : "fixa", frequencia, intervalo: passo,
        dia_vencimento: frequencia === "semanal" ? null : dia, data_inicio: inicio,
        data_fim: parcelada ? null : fim || null, total_parcelas: parcelada ? total : null,
        observacoes: observacoes.trim() || null,
      };
      if (regra && linha) { setEscolhendo({ payload, beneficiarioId }); setOcupado(false); return; }
      if (regra) await financeiro.atualizarRecorrencia(regra.id, { ...payload, ativa });
      else await financeiro.criarRecorrencia(payload);
      onSalvo();
      if (!fixo) onClose();
      else setOcupado(false);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  /** Aplica a edição no alcance escolhido. */
  async function aplicar(escopo: EscopoEdicao) {
    if (!regra || !linha || !escolhendo) return;
    const { payload, beneficiarioId } = escolhendo;
    if (escopo === "todas") await financeiro.atualizarRecorrencia(regra.id, { ...payload, ativa });
    else if (escopo === "proximas") {
      await financeiro.encerrarAPartir(regra.id, linha.data);
      await financeiro.criarRecorrencia({ ...payload, data_inicio: linha.data });
    } else {
      const id = linha.transacaoId ?? (await financeiro.concluir(regra.id, linha.data, dataExibida(linha), { confirmar: false })).transacao_id;
      await vault.transacoes.atualizar(id, {
        tipo: payload.tipo, valor_centavos: payload.valor_centavos, data: dataExibida(linha), descricao: payload.descricao,
        categoria_id: payload.categoria_id ?? undefined, conta_id: payload.conta_id ?? undefined, beneficiario_id: beneficiarioId ?? undefined,
        forma_pagamento: payload.forma_pagamento ?? undefined, status: linha.efetivada ? "efetivada" : "pendente", observacoes: payload.observacoes ?? undefined,
      });
    }
    setEscolhendo(null);
    onSalvo();
    if (!fixo) onClose();
  }

  const progresso = regra?.tipo_recorrencia === "parcelada" && regra.total_parcelas ? regra : null;
  const corpo = (
    <>
      <header>
        <div>
          <p>{editando ? "EDITAR RECORRÊNCIA" : "NOVA RECORRÊNCIA"}</p>
          <h2>{editando ? regra.descricao : "Nova recorrência"}</h2>
        </div>
        <div className="cofre-cats-header-acoes">
          {acoes && <button type="button" className="cofre-rec-mais" aria-label="Duplicar" title="Duplicar" onClick={acoes.onDuplicar}><Copy size={14} /></button>}
          {acoes && <MenuOcorrencia acoes={acoes} rotulo={regra?.descricao ?? "recorrência"} />}
          <button type="button" className="cofre-cats-iconbtn cofre-cats-fechar" aria-label="Fechar" onClick={onClose}><X size={16} /></button>
        </div>
      </header>

      {contexto && <p className="cofre-rec-contexto">{contexto}</p>}
      {regra && !regra.ativa && <p className="cofre-rec-aviso" role="status">Esta recorrência está pausada: nenhuma ocorrência nova é gerada.</p>}
      {progresso && (
        <div className="cofre-rec-progresso" aria-label={`${progresso.efetivadas} de ${progresso.total_parcelas} parcelas efetivadas`}>
          <div><b>{progresso.efetivadas} de {progresso.total_parcelas}</b> parcelas efetivadas<span>{progresso.parcelas_geradas} geradas</span></div>
          <i><u style={{ width: `${Math.min(100, (progresso.efetivadas / progresso.total_parcelas!) * 100)}%` }} /></i>
        </div>
      )}

      <SegmentedSlide className="cofre-launch-slide" ariaLabel="Tipo" tamanho="lg" value={tipo} onChange={(v) => { setTipo(v); setCategoriaId(""); }} opcoes={[{ value: "saida", label: "Despesa", cor: "ecos-error" }, { value: "entrada", label: "Receita", cor: "ecos-success" }]} />

      {centavos !== null && <div className="cofre-rec-previa cofre-mono" data-tipo={tipo}>{tipo === "entrada" ? "+" : "−"}{formatMoeda(centavos)}</div>}

      <div className="cofre-launch-grid">
        <Campo rotulo="Valor"><input className="cofre-mono" value={valor} inputMode="decimal" placeholder="0,00" autoFocus={!fixo && !editando} aria-label="Valor" onChange={(e) => setValor(e.target.value)} /></Campo>
        <Campo rotulo="Categoria"><MenuSelecao ariaLabel="Categoria" value={categoriaId} placeholder="Sem categoria" options={opcoesCategoria} onChange={setCategoriaId} /></Campo>
      </div>
      <Campo rotulo="Descrição"><input value={descricao} placeholder="Ex.: Aluguel, Netflix, Financiamento do carro" aria-label="Descrição" onChange={(e) => setDescricao(e.target.value)} /></Campo>
      <div className="cofre-launch-grid">
        <Campo rotulo={tipo === "entrada" ? "Pagador" : "Beneficiário"}>
          <input list="cofre-rec-beneficiarios" value={beneficiario} placeholder="Ex.: Imobiliária Ideal" aria-label="Beneficiário" onChange={(e) => setBeneficiario(e.target.value)} />
          <datalist id="cofre-rec-beneficiarios">{beneficiarios.map((b) => <option key={b.id} value={b.nome} />)}</datalist>
        </Campo>
        <Campo rotulo="Conta"><MenuSelecao ariaLabel="Conta" value={contaId} placeholder="Sem conta" options={opcoesConta} onChange={setContaId} /></Campo>
      </div>
      <Campo rotulo="Forma de pagamento"><MenuSelecao ariaLabel="Forma de pagamento" value={forma} placeholder="Sem definir" options={opcoesForma} onChange={setForma} /></Campo>

      <SegmentedSlide className="cofre-launch-slide" ariaLabel="Tipo de recorrência" tamanho="lg" value={parcelada ? "parcelada" : "fixa"} onChange={(v) => { if (!travada) setParcelada(v === "parcelada"); }} opcoes={[{ value: "fixa", label: "Fixa", cor: "cofre-blue" }, { value: "parcelada", label: "Parcelada", cor: "cofre-pink" }]} />

      <div className="cofre-launch-grid">
        <Campo rotulo="Frequência"><MenuSelecao semVazio ariaLabel="Frequência" value={frequencia} placeholder="Mensal" options={opcoesFrequencia} onChange={(v) => setFrequencia(v as RecorrenciaPayload["frequencia"])} /></Campo>
        <Campo rotulo="A cada"><input className="cofre-mono" type="number" min={1} max={1200} value={intervalo} aria-label="A cada" onChange={(e) => setIntervalo(e.target.value)} /></Campo>
      </div>
      <div className="cofre-launch-grid">
        <Campo data rotulo="Início"><DatePicker ariaLabel="Início" value={inicio} disabled={travada} onChange={setInicio} /></Campo>
        {parcelada ? <Campo rotulo="Parcelas"><input className="cofre-mono" type="number" min={1} value={parcelas} aria-label="Parcelas" onChange={(e) => setParcelas(e.target.value)} /></Campo> : <Campo data rotulo="Encerra em (opcional)"><DatePicker ariaLabel="Encerra em" limpavel value={fim} onChange={setFim} /></Campo>}
      </div>
      {frequencia !== "semanal" && <Campo rotulo="Dia de vencimento"><input className="cofre-mono" type="number" min={1} max={31} value={diaVencimento} placeholder="mesmo dia do início" aria-label="Dia de vencimento" onChange={(e) => setDiaVencimento(e.target.value)} /></Campo>}
      {travada && <p className="cofre-rec-dica">Início e tipo ficam fixos porque esta recorrência já gerou lançamentos.</p>}
      <Campo rotulo="Observações"><textarea rows={2} value={observacoes} placeholder="Opcional" aria-label="Observações" onChange={(e) => setObservacoes(e.target.value)} /></Campo>

      {editando && (
        <label className="cofre-rec-ativa">
          <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
          <span>Recorrência ativa<small>Desmarque para pausar sem apagar.</small></span>
        </label>
      )}

      {erro && <p role="alert" className="cofre-rec-erro">{erro}</p>}
      <footer>
        <button type="button" className="cofre-secondary" onClick={onClose} disabled={ocupado}>Cancelar</button>
        <button className="cofre-solid" disabled={ocupado}>{ocupado ? "Salvando…" : editando ? "Salvar alterações" : "Criar recorrência"}</button>
      </footer>
    </>
  );

  const escopoDialogo = escolhendo && regra && linha && (
    <EscopoEdicaoModal descricao={regra.descricao} dataOcorrencia={linha.data} permitirProximas={regra.tipo_recorrencia === "fixa" && !linha.efetivada && linha.data > regra.data_inicio}
      onClose={() => setEscolhendo(null)} onConfirmar={aplicar} />
  );
  if (fixo) {
    return <><form className="cofre-card cofre-rec-painel" aria-label={editando ? "Editar recorrência" : "Nova recorrência"} onSubmit={salvar}>{corpo}</form>{escopoDialogo}</>;
  }
  return (
    <div className="cofre-cats-modal">
      <div className="cofre-cats-backdrop" onClick={() => { if (!ocupado) onClose(); }} />
      <form className="cofre-card cofre-cats-dialog cofre-rec-dialogo cofre-rec-form" role="dialog" aria-modal="true" aria-label={editando ? "Editar recorrência" : "Nova recorrência"} onSubmit={salvar}>{corpo}</form>
      {escopoDialogo}
    </div>
  );
}

function Campo({ rotulo, children, data = false }: { rotulo: string; children: ReactNode; data?: boolean }) {
  return <div className={`cofre-launch-field${data ? " cofre-launch-date" : ""}`}><span>{rotulo}</span>{children}</div>;
}
