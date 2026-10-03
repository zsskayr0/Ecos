import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { SeloConta } from "../contas/SeloConta";
import { X } from "lucide-react";
import { SeletorEcos } from "@/components/common/SeletorEcos";
import { financeiro, FORMAS_PAGAMENTO, vault, type BeneficiarioApi, type CategoriaApi, type ContaApi, type RecorrenciaApi, type RecorrenciaPayload } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { MenuOcorrencia, type AcoesDaOcorrencia } from "./MenuOcorrencia";
import { centavosDoCampo, centavosParaCampo } from "./ocorrencias";

const ROTULO_FORMA: Record<string, string> = { pix: "Pix", pix_automatico: "Pix Automático", ted: "TED", cartao: "Cartão", dinheiro: "Dinheiro", boleto: "Boleto", outro: "Outro" };
const FREQUENCIAS = [{ valor: "semanal", rotulo: "Semanal" }, { valor: "mensal", rotulo: "Mensal" }, { valor: "anual", rotulo: "Anual" }] as const;

interface Props {
  /** Ausente: criando uma nova. */
  regra?: RecorrenciaApi;
  categorias: CategoriaApi[];
  contas: ContaApi[];
  beneficiarios: BeneficiarioApi[];
  /** Início sugerido para uma recorrência nova. */
  inicioPadrao: string;
  /** Painel fixo ao lado da lista, em vez de janela por cima. */
  fixo?: boolean;
  /** Menu "…" do cabeçalho (só na edição). */
  acoes?: AcoesDaOcorrencia;
  /** Texto curto de contexto, ex.: "Parcela 3/12 · 10/11/2026". */
  contexto?: string;
  onClose: () => void;
  onSalvo: () => void;
}

export function RecorrenciaModal({ regra, categorias, contas, beneficiarios, inicioPadrao, fixo = false, acoes, contexto, onClose, onSalvo }: Props) {
  const editando = !!regra;
  const [tipo, setTipo] = useState<"entrada" | "saida">(regra?.tipo ?? "saida");
  const [descricao, setDescricao] = useState(regra?.descricao ?? "");
  const [valor, setValor] = useState(regra ? centavosParaCampo(regra.valor_centavos) : "");
  const [categoriaId, setCategoriaId] = useState(regra?.categoria_id ?? "");
  const [beneficiario, setBeneficiario] = useState(() => beneficiarios.find((b) => b.id === regra?.beneficiario_id)?.nome ?? "");
  const [contaId, setContaId] = useState(regra?.conta_id ?? (regra ? "" : contas.find((c) => c.padrao)?.id ?? ""));
  const [forma, setForma] = useState(regra?.forma_pagamento ?? "");
  const [parcelada, setParcelada] = useState(regra?.tipo_recorrencia === "parcelada");
  const [frequencia, setFrequencia] = useState<RecorrenciaPayload["frequencia"]>(regra?.frequencia ?? "mensal");
  const [intervalo, setIntervalo] = useState(String(regra?.intervalo ?? 1));
  const [diaVencimento, setDiaVencimento] = useState(regra?.dia_vencimento ? String(regra.dia_vencimento) : "");
  const [inicio, setInicio] = useState(regra?.data_inicio ?? inicioPadrao);
  const [fim, setFim] = useState(regra?.data_fim ?? "");
  const [parcelas, setParcelas] = useState(regra?.total_parcelas ? String(regra.total_parcelas) : "12");
  const [observacoes, setObservacoes] = useState(regra?.observacoes ?? "");
  const [ativa, setAtiva] = useState(regra?.ativa ?? true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (fixo) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) onClose(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [fixo, ocupado, onClose]);

  // Depois que a série gerou lançamentos, mudar o início ou o tipo bagunçaria o que já foi lançado.
  const travada = !!regra && regra.parcelas_geradas > 0;
  const centavos = centavosDoCampo(valor);
  const opcoesCategoria = useMemo(() => [
    { valor: "", rotulo: "Sem categoria" },
    ...categorias.filter((c) => c.tipo === tipo || c.tipo === "ambos").map((c) => ({ valor: c.id, rotulo: c.nome, cor: c.cor })),
  ], [categorias, tipo]);
  const opcoesConta = useMemo(() => [{ valor: "", rotulo: "Sem conta" }, ...contas.map((c) => ({ valor: c.id, rotulo: c.nome, visual: <SeloConta nome={c.nome} cor={c.cor} tipo={c.tipo} codigoBanco={c.codigo_banco} sigla={c.sigla} tamanho="xs" /> }))], [contas]);
  const opcoesForma = useMemo(() => [{ valor: "", rotulo: "Sem definir" }, ...FORMAS_PAGAMENTO.map((f) => ({ valor: f, rotulo: ROTULO_FORMA[f] ?? f }))], []);

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

  const progresso = regra?.tipo_recorrencia === "parcelada" && regra.total_parcelas ? regra : null;
  const corpo = (
    <>
      <header>
        <div>
          <p>{editando ? "EDITAR RECORRÊNCIA" : "NOVA RECORRÊNCIA"}</p>
          <h2>{editando ? regra.descricao : "Nova recorrência"}</h2>
        </div>
        <div className="cofre-cats-header-acoes">
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

      <div className="cofre-segmented cofre-rec-tipo" role="group" aria-label="Tipo">
        <button type="button" aria-pressed={tipo === "saida"} data-tipo="saida" onClick={() => { setTipo("saida"); setCategoriaId(""); }}>Despesa</button>
        <button type="button" aria-pressed={tipo === "entrada"} data-tipo="entrada" onClick={() => { setTipo("entrada"); setCategoriaId(""); }}>Receita</button>
      </div>

      {centavos !== null && <div className="cofre-rec-previa cofre-mono" data-tipo={tipo}>{tipo === "entrada" ? "+" : "−"}{formatMoeda(centavos)}</div>}

      <div className="cofre-rec-grade">
        <Campo rotulo="Valor"><input className="ecos-input cofre-mono" value={valor} inputMode="decimal" placeholder="0,00" autoFocus={!fixo && !editando} aria-label="Valor" onChange={(e) => setValor(e.target.value)} /></Campo>
        <Campo rotulo="Categoria"><SeletorEcos ariaLabel="Categoria" valor={categoriaId} opcoes={opcoesCategoria} onChange={setCategoriaId} /></Campo>
      </div>
      <Campo rotulo="Descrição"><input className="ecos-input" value={descricao} placeholder="Ex.: Aluguel, Netflix, Financiamento do carro" aria-label="Descrição" onChange={(e) => setDescricao(e.target.value)} /></Campo>
      <div className="cofre-rec-grade">
        <Campo rotulo={tipo === "entrada" ? "Pagador" : "Beneficiário"}>
          <input className="ecos-input" list="cofre-rec-beneficiarios" value={beneficiario} placeholder="Ex.: Imobiliária Ideal" aria-label="Beneficiário" onChange={(e) => setBeneficiario(e.target.value)} />
          <datalist id="cofre-rec-beneficiarios">{beneficiarios.map((b) => <option key={b.id} value={b.nome} />)}</datalist>
        </Campo>
        <Campo rotulo="Conta"><SeletorEcos ariaLabel="Conta" valor={contaId} opcoes={opcoesConta} onChange={setContaId} /></Campo>
      </div>
      <Campo rotulo="Forma de pagamento"><SeletorEcos ariaLabel="Forma de pagamento" valor={forma} opcoes={opcoesForma} onChange={setForma} /></Campo>

      <div className="cofre-segmented cofre-rec-tipo" role="group" aria-label="Tipo de recorrência">
        <button type="button" aria-pressed={!parcelada} disabled={travada} onClick={() => setParcelada(false)}>Fixa</button>
        <button type="button" aria-pressed={parcelada} disabled={travada} onClick={() => setParcelada(true)}>Parcelada</button>
      </div>

      <div className="cofre-rec-grade">
        <Campo rotulo="Frequência"><SeletorEcos ariaLabel="Frequência" valor={frequencia} opcoes={FREQUENCIAS} onChange={(v) => setFrequencia(v)} /></Campo>
        <Campo rotulo="A cada"><input className="ecos-input cofre-mono" type="number" min={1} max={1200} value={intervalo} aria-label="A cada" onChange={(e) => setIntervalo(e.target.value)} /></Campo>
      </div>
      <div className="cofre-rec-grade">
        <Campo rotulo="Início"><input className="ecos-input cofre-mono" type="date" value={inicio} disabled={travada} aria-label="Início" onChange={(e) => setInicio(e.target.value)} /></Campo>
        {parcelada
          ? <Campo rotulo="Parcelas"><input className="ecos-input cofre-mono" type="number" min={1} value={parcelas} aria-label="Parcelas" onChange={(e) => setParcelas(e.target.value)} /></Campo>
          : <Campo rotulo="Dia de vencimento"><input className="ecos-input cofre-mono" type="number" min={1} max={31} value={diaVencimento} disabled={frequencia === "semanal"} placeholder="mesmo dia do início" aria-label="Dia de vencimento" onChange={(e) => setDiaVencimento(e.target.value)} /></Campo>}
      </div>
      {travada && <p className="cofre-rec-dica">Início e tipo ficam fixos porque esta recorrência já gerou lançamentos.</p>}
      {!parcelada && <Campo rotulo="Encerra em (opcional)"><input className="ecos-input cofre-mono" type="date" value={fim} aria-label="Encerra em" onChange={(e) => setFim(e.target.value)} /></Campo>}
      <Campo rotulo="Observações"><textarea className="ecos-input" rows={2} value={observacoes} placeholder="Opcional" aria-label="Observações" onChange={(e) => setObservacoes(e.target.value)} /></Campo>

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

  if (fixo) {
    return <form className="cofre-card cofre-rec-painel" aria-label={editando ? "Editar recorrência" : "Nova recorrência"} onSubmit={salvar}>{corpo}</form>;
  }
  return (
    <div className="cofre-cats-modal">
      <div className="cofre-cats-backdrop" onClick={() => { if (!ocupado) onClose(); }} />
      <form className="cofre-card cofre-cats-dialog cofre-rec-dialogo cofre-rec-form" role="dialog" aria-modal="true" aria-label={editando ? "Editar recorrência" : "Nova recorrência"} onSubmit={salvar}>{corpo}</form>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return <label className="cofre-rec-campo"><span>{rotulo}</span>{children}</label>;
}
