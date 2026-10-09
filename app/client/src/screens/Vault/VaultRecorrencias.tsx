import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowDown, ArrowUp, Check, CloudOff, LayoutGrid, List, PanelRight, Pause, Play, Plus, Repeat2, Table2, Trash2 } from "lucide-react";
import { financeiro, vault, type BeneficiarioApi, type CategoriaApi, type ContaApi, type OcorrenciaRecorrente, type RecorrenciaApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { maiorValor, useModoValor } from "@/lib/exibicao-valores";
import { ValorComIndicador } from "./nexus/IndicadorValor";
import "./recorrencias/recorrencias.css";
import { CategoriaIcone } from "./VaultCategories";
import { PeriodPicker } from "./nexus/PeriodPicker";
import { periodRange, type Period } from "./nexus/period";
import { BarrasPorPeriodo, MapaDeIntensidade } from "./recorrencias/GraficosRecorrencia";
import { ConclusaoParcialModal, ConfirmarModal, ReagendarModal } from "./recorrencias/Dialogos";
import { MenuOcorrencia, type AcoesDaOcorrencia } from "./recorrencias/MenuOcorrencia";
import { RecorrenciaModal } from "./recorrencias/RecorrenciaModal";
import {
  baldesDoPeriodo, dataExibida, filtrarPorTipo, hojeLocalISO, montarLinhas, payloadDaRegra, rotuloDaRegra, rotuloFrequencia, totaisPorBalde,
  type FiltroTipo, type LinhaRecorrencia,
} from "./recorrencias/ocorrencias";

const CHAVE_PAINEL_FIXO = "ecos:cofre:recorrencias-painel-fixo";
const CHAVE_VISAO = "ecos:cofre:recorrencias-visao";
const dataBR = (iso: string) => iso.split("-").reverse().join("/");
const estiloI = (i: number) => ({ "--i": i }) as CSSProperties;

function lerPref(chave: string): string | null {
  try { return localStorage.getItem(chave); } catch { return null; }
}
function gravarPref(chave: string, valor: string) {
  try { localStorage.setItem(chave, valor); } catch { /* armazenamento indisponível: vale só nesta sessão */ }
}

type Painel = { tipo: "nova"; modelo?: RecorrenciaApi } | { tipo: "editar"; regraId: string; linha?: LinhaRecorrencia };
type Confirmacao = { titulo: string; mensagem: React.ReactNode; rotulo: string; acao: () => Promise<void> };

export function VaultRecorrencias({ period, onPeriodChange, categorias, atualizar, recarregar }: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  categorias: CategoriaApi[];
  atualizar: () => void;
  recarregar: number;
}) {
  const { from: de, to: ate } = periodRange(period);
  const [regras, setRegras] = useState<RecorrenciaApi[] | null>(null);
  const [ocorrencias, setOcorrencias] = useState<OcorrenciaRecorrente[]>([]);
  const [contas, setContas] = useState<ContaApi[]>([]);
  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioApi[]>([]);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [filtro, setFiltro] = useState<FiltroTipo>("todas");
  const [visao, setVisao] = useState<"lista" | "tabela">(() => (lerPref(CHAVE_VISAO) === "tabela" ? "tabela" : "lista"));
  const [fixado, setFixado] = useState(() => lerPref(CHAVE_PAINEL_FIXO) === "1");
  const [painel, setPainel] = useState<Painel | null>(null);
  const [parcial, setParcial] = useState<LinhaRecorrencia | null>(null);
  const [reagendando, setReagendando] = useState<LinhaRecorrencia | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const ancora = useRef<string | null>(null);
  const avisoTimer = useRef<number | undefined>(undefined);

  const carregar = useCallback((vivo: () => boolean) => {
    Promise.all([
      financeiro.recorrencias(),
      financeiro.ocorrenciasDoPeriodo({ data_de: de, data_ate: ate }),
      vault.contas.listar().catch(() => [] as ContaApi[]),
      vault.beneficiarios.listar().catch(() => [] as BeneficiarioApi[]),
    ]).then(([r, o, c, b]) => {
      if (!vivo()) return;
      setRegras(r); setOcorrencias(o); setContas(c); setBeneficiarios(b); setErroCarga(null);
    }).catch((e: Error) => { if (vivo()) setErroCarga(e.message); });
  }, [de, ate]);

  useEffect(() => {
    let vivo = true;
    carregar(() => vivo);
    return () => { vivo = false; };
  }, [carregar, versao, recarregar]);
  useEffect(() => () => window.clearTimeout(avisoTimer.current), []);

  const categoriasPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);
  const beneficiariosPorId = useMemo(() => new Map(beneficiarios.map((b) => [b.id, b])), [beneficiarios]);
  const todas = useMemo(() => montarLinhas(regras ?? [], ocorrencias), [regras, ocorrencias]);
  const linhas = useMemo(() => filtrarPorTipo(todas, filtro), [todas, filtro]);
  const modoValor = useModoValor("recorrencias");
  const maxValor = useMemo(() => maiorValor(todas.map((l) => l.valorCentavos)), [todas]);
  const porChave = useMemo(() => new Map(linhas.map((l) => [l.chave, l])), [linhas]);
  const pausadas = useMemo(() => (regras ?? []).filter((r) => !r.ativa), [regras]);
  const baldes = useMemo(() => baldesDoPeriodo(period, de, ate), [period, de, ate]);
  const totais = useMemo(() => totaisPorBalde(linhas, baldes), [linhas, baldes]);
  const mes = period.kind === "month";
  const hoje = hojeLocalISO();
  const aPagar = linhas.reduce((s, l) => s + (l.regra.tipo === "saida" && !l.efetivada ? l.valorCentavos : 0), 0);
  const aReceber = linhas.reduce((s, l) => s + (l.regra.tipo === "entrada" && !l.efetivada ? l.valorCentavos : 0), 0);

  // Mudou o período ou o filtro: a seleção antiga deixou de fazer sentido.
  useEffect(() => { setSelecionadas(new Set()); ancora.current = null; }, [de, ate, filtro]);

  const recarregarTudo = () => { setVersao((v) => v + 1); atualizar(); };
  function avisar(texto: string) {
    setAviso(texto);
    window.clearTimeout(avisoTimer.current);
    avisoTimer.current = window.setTimeout(() => setAviso(null), 4500);
  }
  /** Roda uma ação, recarrega e mostra a falha (se houver) na própria tela. */
  async function executar(fn: () => Promise<unknown>, sucesso?: string): Promise<boolean> {
    setErro(null);
    try { await fn(); recarregarTudo(); if (sucesso) avisar(sucesso); return true; }
    catch (e) { setErro((e as Error).message); return false; }
  }

  // --- Ações por ocorrência --------------------------------------------------------------------------
  const concluir = (l: LinhaRecorrencia) => executar(() => financeiro.concluir(l.regra.id, l.data, dataExibida(l)), "Ocorrência concluída.");
  const concluirParcial = (l: LinhaRecorrencia, pago: number) => financeiro.concluir(l.regra.id, l.data, dataExibida(l), { valor_centavos: pago });
  const reagendar = (l: LinhaRecorrencia, data: string) => (l.transacaoId ? financeiro.reagendar(l.transacaoId, data) : financeiro.concluir(l.regra.id, l.data, data, { confirmar: false }));
  // Duplicar abre uma recorrência nova já preenchida; só é criada quando a pessoa salvar.
  const duplicar = (r: RecorrenciaApi) => setPainel({ tipo: "nova", modelo: { ...r, descricao: `${r.descricao} (cópia)`, parcelas_geradas: 0, efetivadas: 0 } });
  const alternarAtiva = (r: RecorrenciaApi) => executar(() => financeiro.atualizarRecorrencia(r.id, payloadDaRegra(r, { ativa: !r.ativa })), r.ativa ? "Recorrência pausada." : "Recorrência reativada.");
  const apagarEsta = async (l: LinhaRecorrencia) => {
    if (l.transacaoId) await vault.transacoes.excluir(l.transacaoId);
    await financeiro.pularOcorrencia(l.regra.id, l.data);
  };

  function pedirExcluirEsta(l: LinhaRecorrencia, aoConcluir?: () => void) {
    const run = async () => { if (await executar(() => apagarEsta(l), "Ocorrência excluída.")) aoConcluir?.(); };
    if (!l.efetivada) { void run(); return; }
    setConfirmacao({
      titulo: "Excluir esta ocorrência?",
      mensagem: <>O lançamento efetivado de <b>{l.regra.descricao}</b> ({dataBR(l.data)}, {formatMoeda(l.valorCentavos)}) será apagado do extrato. O resto da recorrência continua.</>,
      rotulo: "Excluir ocorrência",
      acao: async () => { await apagarEsta(l); recarregarTudo(); avisar("Ocorrência excluída."); aoConcluir?.(); setConfirmacao(null); },
    });
  }
  function pedirExcluirEstaEProximas(l: LinhaRecorrencia, aoConcluir?: () => void) {
    setConfirmacao({
      titulo: "Excluir esta e as próximas?",
      mensagem: <><b>{l.regra.descricao}</b> deixa de ocorrer a partir de {dataBR(l.data)}. Lançamentos pendentes dessa data em diante são apagados; o que já foi efetivado e os meses anteriores ficam como estão.</>,
      rotulo: "Encerrar daqui",
      acao: async () => { await financeiro.encerrarAPartir(l.regra.id, l.data); recarregarTudo(); avisar("Recorrência encerrada."); aoConcluir?.(); setConfirmacao(null); },
    });
  }
  function pedirExcluirTodas(r: RecorrenciaApi, aoConcluir?: () => void) {
    setConfirmacao({
      titulo: "Excluir toda a recorrência?",
      mensagem: <>A regra <b>{r.descricao}</b> deixa de existir e não gera mais nada. Os lançamentos já feitos continuam no extrato.</>,
      rotulo: "Excluir recorrência",
      acao: async () => { await financeiro.excluirRecorrencia(r.id); recarregarTudo(); avisar("Recorrência excluída."); aoConcluir?.(); setConfirmacao(null); },
    });
  }
  function pedirExcluirSelecionadas() {
    const alvo = [...selecionadas].map((k) => porChave.get(k)).filter((l): l is LinhaRecorrencia => !!l);
    if (!alvo.length) return;
    const efetivadas = alvo.filter((l) => l.efetivada).length;
    setConfirmacao({
      titulo: `Excluir ${alvo.length} ocorrência${alvo.length > 1 ? "s" : ""}?`,
      mensagem: <>Cada uma some só da data em que está; o resto de cada recorrência continua.{efetivadas > 0 && <> {efetivadas} já {efetivadas > 1 ? "estão efetivadas e seus lançamentos serão apagados" : "está efetivada e seu lançamento será apagado"} do extrato.</>}</>,
      rotulo: "Excluir selecionadas",
      acao: async () => {
        for (const l of alvo) await apagarEsta(l);
        setSelecionadas(new Set());
        recarregarTudo();
        avisar(`${alvo.length} ocorrência${alvo.length > 1 ? "s excluídas" : " excluída"}.`);
        setConfirmacao(null);
      },
    });
  }

  /** Monta o menu "…" — da linha (com "Editar") ou do painel de edição (sem "Editar", e fechando o painel ao apagar). */
  function acoesDe(regra: RecorrenciaApi, linha: LinhaRecorrencia | undefined, noPainel: boolean): AcoesDaOcorrencia {
    const fechar = noPainel ? () => setPainel(null) : undefined;
    const pendente = linha && !linha.efetivada;
    // Efetivar o que ainda não venceu não faz sentido: fica como previsto até o dia.
    const vencida = !!linha && dataExibida(linha) <= hojeLocalISO();
    return {
      onEditar: noPainel ? undefined : () => setPainel({ tipo: "editar", regraId: regra.id, linha }),
      onDuplicar: () => duplicar(regra),
      onConcluir: pendente && vencida ? () => void concluir(linha).then((ok) => ok && fechar?.()) : undefined,
      onConcluirParcial: pendente && vencida ? () => setParcial(linha) : undefined,
      onReagendar: linha ? () => setReagendando(linha) : undefined,
      ativa: regra.ativa,
      onAlternarAtiva: () => void alternarAtiva(regra).then((ok) => ok && fechar?.()),
      onExcluirEsta: linha ? () => pedirExcluirEsta(linha, fechar) : undefined,
      onExcluirEstaEProximas: linha ? () => pedirExcluirEstaEProximas(linha, fechar) : undefined,
      onExcluirTodas: () => pedirExcluirTodas(regra, fechar),
    };
  }

  // --- Seleção (Ctrl/Cmd alterna, Shift marca o intervalo) ---------------------------------------------
  function clicarLinha(l: LinhaRecorrencia, e: ReactMouseEvent) {
    if (e.shiftKey && ancora.current) {
      const ordem = linhas.map((x) => x.chave);
      const a = ordem.indexOf(ancora.current), b = ordem.indexOf(l.chave);
      if (a >= 0 && b >= 0) {
        const [i, j] = a < b ? [a, b] : [b, a];
        setSelecionadas(new Set(ordem.slice(i, j + 1)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setSelecionadas((atual) => { const novo = new Set(atual); if (!novo.delete(l.chave)) novo.add(l.chave); return novo; });
      ancora.current = l.chave;
      return;
    }
    if (selecionadas.size > 0) { setSelecionadas(new Set()); return; }
    setPainel({ tipo: "editar", regraId: l.regra.id, linha: l });
  }

  function alternarFixado() { setFixado((v) => { gravarPref(CHAVE_PAINEL_FIXO, v ? "0" : "1"); return !v; }); }
  function trocarVisao(v: "lista" | "tabela") { setVisao(v); gravarPref(CHAVE_VISAO, v); }

  const semRegras = regras !== null && regras.length === 0;
  /** Painel fixo só faz sentido com a lista na tela; sem nenhuma recorrência ele abre como janela. */
  const modoFixo = fixado && !semRegras && regras !== null;
  const regraDoPainel = painel?.tipo === "editar" ? regras?.find((r) => r.id === painel.regraId) : undefined;
  const painelAberto = painel?.tipo === "nova" || !!regraDoPainel;
  const modalRegra = painelAberto ? (
    <RecorrenciaModal
      modelo={painel?.tipo === "nova" ? painel.modelo : undefined}
      key={painel?.tipo === "editar" ? `${painel.regraId}:${painel.linha?.data ?? ""}:${regraDoPainel?.atualizado_em}` : "nova"}
      regra={regraDoPainel} categorias={categorias} contas={contas} beneficiarios={beneficiarios} inicioPadrao={mes ? de : hoje} fixo={modoFixo}
      acoes={regraDoPainel ? acoesDe(regraDoPainel, painel?.tipo === "editar" ? painel.linha : undefined, true) : undefined}
      linha={painel?.tipo === "editar" ? painel.linha : undefined}
      contexto={painel?.tipo === "editar" && painel.linha ? `${rotuloDaRegra(painel.linha)} · vence em ${dataBR(painel.linha.data)} · ${painel.linha.efetivada ? "efetivada" : "pendente"}` : undefined}
      onClose={() => setPainel(null)} onSalvo={() => { recarregarTudo(); if (painel?.tipo === "nova") setPainel(null); }}
    />
  ) : null;

  const carregando = regras === null && !erroCarga;

  return (
    <section className="cofre-cats cofre-rec">
      <div className="cofre-cats-top cofre-rise" style={estiloI(0)}>
        <h1>Recorrências</h1>
        <div className="cofre-cats-actions">
          <PeriodPicker value={period} onChange={onPeriodChange} />
          <button type="button" className="cofre-new-button" onClick={() => setPainel({ tipo: "nova" })}><Plus size={14} />Nova recorrência</button>
        </div>
      </div>

      {erroCarga && (
        <div role="alert" className="cofre-error-card">
          <span className="cofre-error-icon"><CloudOff size={25} /></span>
          <h2>Não foi possível carregar as recorrências</h2>
          <p>{erroCarga}</p>
          <div><button type="button" className="cofre-solid" onClick={() => setVersao((v) => v + 1)}>Tentar novamente</button></div>
        </div>
      )}
      {erro && <p role="alert" className="cofre-rec-faixa" data-tom="erro">{erro}</p>}
      <p role="status" className="cofre-rec-faixa" data-vazia={!aviso || undefined}>{aviso}</p>

      {carregando && <div className="cofre-cats-skeleton" role="status" aria-label="Carregando recorrências">{[0, 1, 2].map((i) => <div key={i} style={estiloI(i)} />)}</div>}

      {semRegras && (
        <div className="cofre-card cofre-cats-empty cofre-rise" style={estiloI(1)}>
          <Repeat2 size={30} />
          <p>Nenhuma recorrência cadastrada</p>
          <small>Cadastre receitas e despesas fixas (aluguel, salário, assinaturas) ou parceladas. O Cofre gera os lançamentos no vencimento e avisa o que ainda está pendente.</small>
          <button type="button" className="cofre-new-button" onClick={() => setPainel({ tipo: "nova" })}><Plus size={14} />Nova recorrência</button>
        </div>
      )}

      {regras !== null && regras.length > 0 && (
        <div className="cofre-rec-corpo" data-fixo={(modoFixo && painelAberto) || undefined}>
          <div className="cofre-rec-principal">
            {selecionadas.size > 0 && (
              <div className="cofre-card cofre-rec-selecao" role="status">
                <span>{selecionadas.size} selecionada{selecionadas.size > 1 ? "s" : ""}</span>
                <div>
                  <button type="button" className="cofre-secondary" onClick={() => setSelecionadas(new Set())}>Cancelar</button>
                  <button type="button" className="cofre-rec-perigo" onClick={pedirExcluirSelecionadas}><Trash2 size={13} />Excluir selecionadas</button>
                </div>
              </div>
            )}

            <div className="cofre-rec-barra cofre-rise" style={estiloI(1)}>
              <div className="cofre-cats-chips" role="group" aria-label="Filtrar por tipo">
                <button type="button" aria-pressed={filtro === "todas"} onClick={() => setFiltro("todas")}><LayoutGrid size={12} /> Todas</button>
                <button type="button" aria-pressed={filtro === "entrada"} onClick={() => setFiltro("entrada")}><ArrowUp size={12} /> Apenas receitas</button>
                <button type="button" aria-pressed={filtro === "saida"} data-perigo onClick={() => setFiltro("saida")}><ArrowDown size={12} /> Apenas despesas</button>
              </div>
              <div className="cofre-rec-barra-dir">
                <div className="cofre-segmented" role="group" aria-label="Modo de exibição">
                  <button type="button" aria-pressed={visao === "lista"} onClick={() => trocarVisao("lista")}><List size={13} /> Lista</button>
                  <button type="button" aria-pressed={visao === "tabela"} onClick={() => trocarVisao("tabela")}><Table2 size={13} /> Tabela</button>
                </div>
                <button type="button" className="cofre-rec-fixar" aria-pressed={fixado} title={fixado ? "Painel fixo — clique para voltar a janela" : "Fixar painel de edição ao lado"} aria-label="Fixar painel lateral" onClick={alternarFixado}><PanelRight size={14} /></button>
              </div>
            </div>

            {linhas.length > 0 && (
              <div className="cofre-rec-graficos">
                <div className="cofre-card cofre-rec-grafico cofre-rec-grafico-calor cofre-rise" data-mes={mes || undefined} style={estiloI(2)}>
                  <h4>Intensidade de despesas</h4>
                  <MapaDeIntensidade totais={totais} hoje={hoje} />
                </div>
                <div className="cofre-card cofre-rec-grafico cofre-rec-grafico-barras cofre-rise" style={estiloI(3)}>
                  <div className="cofre-rec-grafico-topo">
                    <h4>Por período</h4>
                  </div>
                  <BarrasPorPeriodo totais={totais} hoje={hoje} />
                </div>
              </div>
            )}

            <div className="cofre-card cofre-rec-lista cofre-rise" style={estiloI(4)}>
              {linhas.length === 0 ? (
                <p className="cofre-cats-none">{todas.length === 0 ? "Nenhuma recorrência cai neste período." : "Nenhuma ocorrência deste tipo no período."}</p>
              ) : visao === "lista" ? linhas.map((l, i) => {
                const cat = categoriasPorId.get(l.regra.categoria_id ?? "");
                const quem = beneficiariosPorId.get(l.regra.beneficiario_id ?? "")?.nome;
                const sel = selecionadas.has(l.chave);
                return (
                  <div key={l.chave} className="cofre-rec-linha" data-sel={sel || undefined} style={{ ...estiloI(Math.min(i, 12)), boxShadow: cat ? `inset 3px 0 0 ${cat.cor}` : undefined }}
                    onClick={(e) => clicarLinha(l, e)} onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}>
                    <CategoriaIcone categoria={cat} tamanho={17} />
                    <div className="cofre-rec-linha-texto">
                      <button type="button" className="cofre-rec-titulo" aria-label={`Editar ${l.regra.descricao}, vencimento ${dataBR(l.data)}`}>{l.regra.descricao}</button>
                      <small>{quem ?? "—"} · {rotuloDaRegra(l)}</small>
                    </div>
                    <div className="cofre-rec-data" data-vencida={(!l.efetivada && dataExibida(l) < hoje) || undefined}>
                      {dataBR(dataExibida(l))}{l.reagendadaPara && <small title={`Vencimento original ${dataBR(l.data)}`}>reagendada</small>}
                    </div>
                    <Status efetivada={l.efetivada} />
                    <b className="cofre-rec-valor cofre-mono" data-tipo={l.regra.tipo} data-modo={modoValor}><ValorComIndicador modo={modoValor} valor={l.valorCentavos} max={maxValor} cor={l.regra.tipo === "entrada" ? "var(--cofre-income)" : "var(--cofre-expense)"}>{l.regra.tipo === "entrada" ? "+" : "−"}{formatMoeda(l.valorCentavos)}</ValorComIndicador></b>
                    <MenuOcorrencia acoes={acoesDe(l.regra, l, false)} rotulo={`${l.regra.descricao}, ${dataBR(l.data)}`} />
                  </div>
                );
              }) : (
                <div className="cofre-rec-tabela-rolagem">
                  <table className="cofre-rec-tabela">
                    <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Status</th><th className="num">Valor</th><th aria-label="Ações" /></tr></thead>
                    <tbody>
                      {linhas.map((l) => {
                        const cat = categoriasPorId.get(l.regra.categoria_id ?? "");
                        return (
                          <tr key={l.chave} data-sel={selecionadas.has(l.chave) || undefined} style={cat ? { boxShadow: `inset 3px 0 0 ${cat.cor}` } : undefined}
                            onClick={(e) => clicarLinha(l, e)} onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}>
                            <td className="cofre-mono" data-vencida={(!l.efetivada && dataExibida(l) < hoje) || undefined}>{dataBR(dataExibida(l))}</td>
                            <td><button type="button" className="cofre-rec-titulo" aria-label={`Editar ${l.regra.descricao}, vencimento ${dataBR(l.data)}`}>{l.regra.descricao}</button><small>{rotuloDaRegra(l)}</small></td>
                            <td><span className="cofre-rec-cat">{cat && <CategoriaIcone categoria={cat} tamanho={11} className="cofre-cats-icon sm" />}{cat?.nome ?? "—"}</span></td>
                            <td><Status efetivada={l.efetivada} /></td>
                            <td className="num cofre-mono" data-tipo={l.regra.tipo}><ValorComIndicador modo={modoValor} valor={l.valorCentavos} max={maxValor} cor={l.regra.tipo === "entrada" ? "var(--cofre-income)" : "var(--cofre-expense)"}>{l.regra.tipo === "entrada" ? "+" : "−"}{formatMoeda(l.valorCentavos)}</ValorComIndicador></td>
                            <td className="acoes"><MenuOcorrencia acoes={acoesDe(l.regra, l, false)} rotulo={`${l.regra.descricao}, ${dataBR(l.data)}`} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {linhas.length > 0 && (
              <div className="cofre-cats-footer cofre-rise" style={estiloI(5)}>
                <span>{linhas.length} ocorrência{linhas.length === 1 ? "" : "s"} no período{aPagar > 0 && <> · a pagar <b className="cofre-mono">{formatMoeda(aPagar)}</b></>}{aReceber > 0 && <> · a receber <b className="cofre-mono">{formatMoeda(aReceber)}</b></>}</span>
                <span>Ctrl/Shift + clique seleciona várias</span>
              </div>
            )}

            {pausadas.length > 0 && (
              <details className="cofre-card cofre-rec-pausadas">
                <summary><Pause size={13} />Pausadas ({pausadas.length})</summary>
                {pausadas.map((r) => (
                  <div key={r.id} className="cofre-rec-pausada">
                    <button type="button" className="cofre-rec-titulo" onClick={() => setPainel({ tipo: "editar", regraId: r.id })}>{r.descricao}</button>
                    <small>{rotuloFrequencia(r)} · {formatMoeda(r.valor_centavos)}</small>
                    <button type="button" className="cofre-secondary" onClick={() => void alternarAtiva(r)}><Play size={12} />Reativar</button>
                  </div>
                ))}
              </details>
            )}
          </div>
          {modoFixo && painelAberto && <aside className="cofre-rec-dock">{modalRegra}</aside>}
        </div>
      )}

      {!modoFixo && modalRegra}

      {parcial && <ConclusaoParcialModal linha={parcial} onClose={() => setParcial(null)} onConfirmar={async (pago) => { await concluirParcial(parcial, pago); setParcial(null); setPainel(null); recarregarTudo(); avisar("Conclusão parcial registrada; o restante virou pendência."); }} />}
      {reagendando && <ReagendarModal linha={reagendando} atual={dataExibida(reagendando)} onClose={() => setReagendando(null)} onConfirmar={async (data) => { await reagendar(reagendando, data); setReagendando(null); recarregarTudo(); avisar("Ocorrência reagendada."); }} />}
      {confirmacao && <ConfirmarModal titulo={confirmacao.titulo} mensagem={confirmacao.mensagem} rotuloConfirmar={confirmacao.rotulo} onClose={() => setConfirmacao(null)} onConfirmar={confirmacao.acao} />}
    </section>
  );
}

function Status({ efetivada }: { efetivada: boolean }) {
  return <span className="cofre-rec-status" data-efetivada={efetivada || undefined}>{efetivada && <Check size={9} strokeWidth={3} />}{efetivada ? "Efetivado" : "Pendente"}</span>;
}
