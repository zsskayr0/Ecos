import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CheckCircle2, Download, FileText, Info, Paperclip, Pencil, TriangleAlert } from "lucide-react";
import { ApiError, vault, type CategoriaApi, type FechamentoApi, type FechamentoContaApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { baixarArquivo } from "@/lib/baixar-arquivo";
import { PeriodPicker } from "./nexus/PeriodPicker";
import { formatBR, periodLabel, periodRange, type Period } from "./nexus/period";
import { ErroLista } from "./cadastros/CadastroLista";
import { SeloConta } from "./contas/SeloConta";
import { LucrosDoMes } from "./fechamento/LucrosDoMes";
import { TransferenciasEntreContas } from "./fechamento/TransferenciasEntreContas";
import { centavosBR, centavosParaCampo } from "./contas/analise";
import { PENDENCIAS, agruparCategorias, precisaConferir, situacaoDoFechamento, type GrupoFechamento } from "./fechamento/analise";
import "./recorrencias/recorrencias.css";
import "./fechamento/fechamento.css";

const estiloI = (i: number) => ({ "--i": i }) as CSSProperties;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Fechamento do período para a contabilidade: o extrato de cada conta (para conferir com o do banco), o resultado por
 * categoria e o que ainda impede de fechar. Os números são de caixa: só entram lançamentos efetivados.
 */
export function VaultFechamento({ period, onPeriodChange, categorias, recarregar, atualizar, abrir, irParaComprovantes }: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  categorias: CategoriaApi[];
  recarregar: number;
  atualizar: () => void;
  abrir: (id: string) => void;
  irParaComprovantes: () => void;
}) {
  const { from: de, to: ate } = periodRange(period);
  const [dados, setDados] = useState<FechamentoApi | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [gerando, setGerando] = useState<"pacote" | "pdf" | null>(null);
  const [falhaPacote, setFalhaPacote] = useState<string | null>(null);

  // Trocar de período esvazia a tela (aparece o esqueleto); gravar uma conferência só troca os números no lugar.
  useEffect(() => { setDados(null); }, [de, ate]);
  useEffect(() => {
    let vivo = true;
    setErro(null);
    vault.fechamento.obter({ data_de: de, data_ate: ate })
      .then((d) => { if (vivo) setDados(d); })
      .catch((e: Error) => { if (vivo) setErro(e instanceof ApiError && e.status === 404 ? "O Cofre em execução ainda não oferece o Fechamento. Atualize o Cofre no servidor." : e.message); });
    return () => { vivo = false; };
  }, [de, ate, versao, recarregar]);

  const situacao = useMemo(() => (dados ? situacaoDoFechamento(dados) : null), [dados]);

  async function gerar(o: "pacote" | "pdf") {
    setFalhaPacote(null);
    setGerando(o);
    const sufixo = dados?.mes ?? `${de}_a_${ate}`;
    try {
      if (o === "pacote") baixarArquivo(await vault.fechamento.pacote({ data_de: de, data_ate: ate }), `fechamento-${sufixo}.zip`);
      else baixarArquivo(await vault.fechamento.resumoPdf({ data_de: de, data_ate: ate }), `resumo-fechamento-${sufixo}.pdf`);
    } catch (e) {
      setFalhaPacote(e instanceof ApiError ? e.message : o === "pacote" ? "Não foi possível gerar o pacote." : "Não foi possível gerar o PDF.");
    } finally {
      setGerando(null);
    }
  }

  return (
    <section className="cofre-cats cofre-rec fech">
      <div className="cofre-cats-top cofre-rise" style={estiloI(0)}>
        <h1>Fechamento</h1>
        <div className="cofre-cats-actions">
          <PeriodPicker value={period} onChange={onPeriodChange} />
          <button type="button" className="cofre-secondary fech-pdf" disabled={gerando !== null || !dados} onClick={() => void gerar("pdf")} title="Só o resumo do período em PDF, para ler, arquivar ou imprimir">
            <FileText size={14} aria-hidden />{gerando === "pdf" ? "Gerando…" : "Resumo em PDF"}
          </button>
          <button type="button" className="cofre-solid fech-pacote" disabled={gerando !== null || !dados} onClick={() => void gerar("pacote")} title="Resumo em PDF, planilhas do período e os comprovantes, notas fiscais e recibos de lucros, num único arquivo .zip">
            <Download size={14} aria-hidden />{gerando === "pacote" ? "Gerando…" : "Pacote para a contabilidade"}
          </button>
        </div>
      </div>
      {falhaPacote && <p role="alert" className="fech-erro fech-lucros-msg">{falhaPacote}</p>}

      {erro && <ErroLista mensagem={erro} aoTentar={() => setVersao((v) => v + 1)} />}
      {!dados && !erro && <div className="cofre-cats-skeleton" role="status" aria-label="Preparando o fechamento">{[0, 1, 2].map((i) => <div key={i} style={estiloI(i)} />)}</div>}

      {dados && situacao && !erro && (
        <>
          <Situacao dados={dados} situacao={situacao} rotulo={periodLabel(period)} />

          <div className="cofre-cats-trio cofre-rise" style={estiloI(2)}>
            <Resumo rotulo="Entradas" valor={dados.totais.entradas} tom="pos" />
            <Resumo rotulo="Saídas" valor={dados.totais.saidas} tom="neg" />
            <Resumo rotulo="Resultado do período" valor={dados.totais.resultado} tom={dados.totais.resultado < 0 ? "neg" : "pos"} />
          </div>

          <Extrato dados={dados} aoGravar={() => { setVersao((v) => v + 1); atualizar(); }} />

          <LucrosDoMes lucros={dados.lucros} categorias={categorias} abrir={abrir} aoMudar={() => { setVersao((v) => v + 1); atualizar(); }} />

          <TransferenciasEntreContas transferencias={dados.transferencias} categorias={categorias} idLucros={dados.lucros.categoria_id} aoMudar={() => { setVersao((v) => v + 1); atualizar(); }} />

          <Pendencias dados={dados} abrir={abrir} irParaComprovantes={irParaComprovantes} />

          <div className="fech-categorias">
            <Categorias titulo="Entradas por categoria" tom="pos" grupos={agruparCategorias(dados.categorias, "entrada", categorias)} total={dados.totais.entradas} />
            <Categorias titulo="Saídas por categoria" tom="neg" grupos={agruparCategorias(dados.categorias, "saida", categorias)} total={dados.totais.saidas} />
          </div>
          <p className="cofre-rec-dica">Só entram lançamentos efetivados, pela data do lançamento. Pendentes ficam de fora até serem efetivados.</p>
        </>
      )}
    </section>
  );
}

function Situacao({ dados, situacao, rotulo }: { dados: FechamentoApi; situacao: ReturnType<typeof situacaoDoFechamento>; rotulo: string }) {
  const partes: string[] = [];
  if (situacao.bloqueios > 0) partes.push(plural(situacao.bloqueios, "tipo de pendência a resolver", "tipos de pendência a resolver"));
  if (situacao.recibosFaltando > 0) partes.push(plural(situacao.recibosFaltando, "recibo de lucros a anexar", "recibos de lucros a anexar"));
  if (situacao.divergentes > 0) partes.push(plural(situacao.divergentes, "conta que não bate com o banco", "contas que não batem com o banco"));
  if (situacao.aConferir > 0) partes.push(plural(situacao.aConferir, "conta a conferir com o banco", "contas a conferir com o banco"));
  const avisoTransferencia = situacao.transferenciasSemPar && <> As transferências entre contas não se compensam: falta lançar o outro lado.</>;

  if (!dados.mes) {
    return (
      <div className="cofre-card fech-situacao cofre-rise" data-tom="info" style={estiloI(1)} role="status">
        <Info size={18} aria-hidden />
        <p><b>{rotulo}.</b> Para conferir com o extrato do banco e fechar, escolha um mês inteiro no seletor de período.{situacao.bloqueios > 0 && <> Há {plural(situacao.bloqueios, "tipo de pendência", "tipos de pendência")} neste período.</>}</p>
      </div>
    );
  }
  if (situacao.pronto) {
    return (
      <div className="cofre-card fech-situacao cofre-rise" data-tom="ok" style={estiloI(1)} role="status">
        <CheckCircle2 size={18} aria-hidden />
        <p><b>{rotulo} está pronto para a contabilidade.</b> Sem pendências que impeçam, todas as contas batem com o banco e as distribuições de lucros têm recibo.{situacao.atencao > 0 && <> Ainda há itens de atenção abaixo (comprovantes, conciliação, transferências).</>}</p>
      </div>
    );
  }
  return (
    <div className="cofre-card fech-situacao cofre-rise" data-tom="alerta" style={estiloI(1)} role="status">
      <TriangleAlert size={18} aria-hidden />
      <p><b>{rotulo} ainda não está pronto.</b> Falta: {partes.join(", ")}.{avisoTransferencia}</p>
    </div>
  );
}

function Resumo({ rotulo, valor, tom }: { rotulo: string; valor: number; tom: "pos" | "neg" }) {
  return <div className="cofre-card cofre-cats-card fech-resumo"><span>{rotulo}</span><b className="cofre-mono" data-tom={tom}>{formatMoeda(valor)}</b></div>;
}

function Extrato({ dados, aoGravar }: { dados: FechamentoApi; aoGravar: () => void }) {
  const conferivel = dados.mes !== null;
  const comTransferencias = dados.transferencias.configurada;
  const vazio = dados.contas.length === 0;
  return (
    <section className="fech-bloco cofre-rise" style={estiloI(3)} aria-label="Extrato por conta">
      <header><h2>Extrato por conta</h2>{conferivel && <p>Digite o saldo que o extrato do banco mostra no último dia do mês; a diferença aparece na hora.</p>}</header>
      {vazio ? (
        <div className="cofre-card cofre-cats-empty"><p>Nenhuma conta cadastrada</p><small>Cadastre as contas em Cadastros para ver o extrato de cada uma.</small></div>
      ) : (
        <div className="cofre-card cofre-rec-lista">
          <div className="cofre-rec-tabela-rolagem">
            <table className="cofre-rec-tabela fech-tabela">
              <caption className="sr-only">Saldo inicial, entradas, saídas e saldo final de cada conta no período</caption>
              <thead>
                <tr>
                  <th scope="col">Conta</th><th scope="col" className="num">Saldo inicial</th><th scope="col" className="num">Entradas</th><th scope="col" className="num">Saídas</th>
                  {comTransferencias && <th scope="col" className="num">Transferências</th>}
                  <th scope="col" className="num">Saldo final</th>
                  {conferivel && <><th scope="col" className="num">Saldo no banco</th><th scope="col" className="num">Diferença</th></>}
                </tr>
              </thead>
              <tbody>
                {dados.contas.map((c) => <LinhaConta key={c.conta_id ?? "sem-conta"} conta={c} mes={dados.mes} dataDe={dados.data_de} comTransferencias={comTransferencias} aoGravar={aoGravar} />)}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="num cofre-mono">{formatMoeda(dados.totais.saldo_inicial)}</td>
                  <td className="num cofre-mono">{formatMoeda(dados.totais.entradas)}</td>
                  <td className="num cofre-mono">{formatMoeda(dados.totais.saidas)}</td>
                  {comTransferencias && <td className="num cofre-mono">{formatMoeda(dados.totais.transferencias)}</td>}
                  <td className="num cofre-mono">{formatMoeda(dados.totais.saldo_final)}</td>
                  {conferivel && <><td /><td /></>}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

const campoDoSaldo = (c: number | null) => (c === null ? "" : centavosParaCampo(c) || "0,00");

function LinhaConta({ conta, mes, dataDe, comTransferencias, aoGravar }: { conta: FechamentoContaApi; mes: string | null; dataDe: string; comTransferencias: boolean; aoGravar: () => void }) {
  const [texto, setTexto] = useState(campoDoSaldo(conta.saldo_banco));
  const [invalido, setInvalido] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  // O valor que veio do servidor manda: depois de gravar (ou ao trocar de mês) o campo mostra o que ficou guardado.
  useEffect(() => { setTexto(campoDoSaldo(conta.saldo_banco)); setInvalido(false); setFalha(null); }, [conta.saldo_banco, mes]);

  const conferir = conta.conta_id !== null && precisaConferir(conta);
  async function gravar() {
    if (!mes || !conta.conta_id) return;
    const t = texto.trim();
    const novo = t === "" ? null : centavosBR(t);
    if (t !== "" && novo === null) { setInvalido(true); return; }
    setInvalido(false);
    if (novo === conta.saldo_banco) { setTexto(campoDoSaldo(novo)); return; }
    setSalvando(true);
    setFalha(null);
    try {
      await vault.fechamento.conferir({ mes, conta_id: conta.conta_id, saldo_banco_centavos: novo });
      aoGravar();
    } catch (e) {
      setFalha((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const diferenca = conta.diferenca;
  return (
    <tr className="fech-linha" data-sem-conta={conta.conta_id === null || undefined}>
      <th scope="row">
        <span className="fech-conta">
          {conta.conta_id !== null && <SeloConta nome={conta.nome} cor={conta.cor} tipo={conta.tipo} codigoBanco={conta.codigo_banco} sigla={conta.sigla} tamanho="sm" />}
          <span><b>{conta.nome}</b><small>{conta.conta_id === null ? "Lançamentos sem conta escolhida" : plural(conta.lancamentos, "lançamento", "lançamentos")}</small></span>
        </span>
      </th>
      <td className="num fech-inicial"><SaldoInicial conta={conta} dataDe={dataDe} aoGravar={aoGravar} /></td>
      <td className="num cofre-mono fech-pos">{formatMoeda(conta.entradas)}</td>
      <td className="num cofre-mono fech-neg">{formatMoeda(conta.saidas)}</td>
      {comTransferencias && <td className="num cofre-mono">{conta.transferencias === 0 ? <span className="fech-nada">—</span> : formatMoeda(conta.transferencias)}</td>}
      <td className="num cofre-mono">{formatMoeda(conta.saldo_final)}</td>
      {mes !== null && (
        <>
          <td className="num fech-banco">
            {conta.conta_id === null ? <span className="fech-nada">—</span> : (
              <>
                <input
                  type="text" inputMode="decimal" className="fech-campo cofre-mono" value={texto} placeholder={conferir ? "0,00" : "—"} disabled={salvando}
                  aria-label={`Saldo no banco de ${conta.nome} no fim do mês`} aria-invalid={invalido || undefined}
                  onChange={(e) => { setTexto(e.target.value); setInvalido(false); }}
                  onBlur={() => void gravar()}
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                />
                {invalido && <small className="fech-erro" role="alert">Valor inválido</small>}
                {falha && <small className="fech-erro" role="alert">{falha}</small>}
                {!invalido && !falha && conta.conferido_em && <small className="fech-nada">em {formatBR(conta.conferido_em.slice(0, 10))}</small>}
              </>
            )}
          </td>
          <td className="num cofre-mono fech-diferenca" data-estado={diferenca === null ? undefined : diferenca === 0 ? "ok" : "erro"}>
            {diferenca === null ? <span className="fech-nada">—</span> : diferenca === 0 ? <><CheckCircle2 size={13} aria-hidden /> Bate</> : formatMoeda(diferenca)}
          </td>
        </>
      )}
    </tr>
  );
}

const mesBR = (aaaaMm: string) => `${aaaaMm.slice(5, 7)}/${aaaaMm.slice(0, 4)}`;

/**
 * Saldo inicial da conta no período. Por padrão vem do cadastro da conta (somado aos lançamentos anteriores); aqui dá para
 * dizer "no começo deste período a conta tinha tanto" — normalmente o saldo que o extrato do banco mostra —, e dali em diante
 * o Fechamento parte desse número. Vale só para o Fechamento: o saldo da conta no resto do Cofre não muda.
 */
function SaldoInicial({ conta, dataDe, aoGravar }: { conta: FechamentoContaApi; dataDe: string; aoGravar: () => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [invalido, setInvalido] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  if (conta.conta_id === null) return <span className="cofre-mono">{formatMoeda(conta.saldo_inicial)}</span>;
  const id = conta.conta_id;
  const sugestao = conta.saldo_banco_anterior !== null && conta.mes_anterior && !conta.abertura_neste_periodo && conta.saldo_banco_anterior !== conta.saldo_inicial ? conta.saldo_banco_anterior : null;
  const origem = conta.abertura
    ? conta.abertura_neste_periodo ? `Informado para ${formatBR(conta.abertura.data)}` : `A partir de ${formatBR(conta.abertura.data)}`
    : "Do cadastro da conta";

  async function gravar(saldo: number | null) {
    setSalvando(true);
    setFalha(null);
    try {
      await vault.fechamento.definirAbertura({ conta_id: id, data: dataDe, saldo_centavos: saldo });
      setEditando(false);
      aoGravar();
    } catch (e) {
      setFalha((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  function salvar() {
    const t = texto.trim();
    const valor = centavosBR(t);
    if (t === "" || valor === null) { setInvalido(true); return; }
    setInvalido(false);
    void gravar(valor);
  }

  if (editando) {
    return (
      <div className="fech-inicial-edicao">
        <input
          type="text" inputMode="decimal" className="fech-campo cofre-mono" value={texto} placeholder="0,00" disabled={salvando} autoFocus
          aria-label={`Saldo de ${conta.nome} no começo de ${formatBR(dataDe)}`} aria-invalid={invalido || undefined}
          onChange={(e) => { setTexto(e.target.value); setInvalido(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") salvar(); if (e.key === "Escape") setEditando(false); }}
        />
        <small className="fech-nada">Saldo no começo de {formatBR(dataDe)}, antes dos lançamentos do dia.</small>
        {invalido && <small className="fech-erro" role="alert">Valor inválido</small>}
        {falha && <small className="fech-erro" role="alert">{falha}</small>}
        <span className="fech-inicial-acoes">
          <button type="button" className="fech-link" disabled={salvando} onClick={salvar}>Salvar</button>
          <button type="button" className="fech-link" disabled={salvando} onClick={() => { setEditando(false); setInvalido(false); setFalha(null); }}>Cancelar</button>
          {conta.abertura_neste_periodo && <button type="button" className="fech-link" disabled={salvando} onClick={() => void gravar(null)}>Voltar ao cadastro</button>}
        </span>
      </div>
    );
  }
  return (
    <div className="fech-inicial-vista">
      <span className="cofre-mono">{formatMoeda(conta.saldo_inicial)}</span>
      <small className="fech-nada">{origem}</small>
      {falha && <small className="fech-erro" role="alert">{falha}</small>}
      <span className="fech-inicial-acoes">
        <button type="button" className="fech-link" aria-label={`Ajustar o saldo inicial de ${conta.nome}`} onClick={() => { setTexto(centavosParaCampo(conta.saldo_inicial) || "0,00"); setInvalido(false); setFalha(null); setEditando(true); }}><Pencil size={11} aria-hidden /> Ajustar</button>
        {sugestao !== null && conta.mes_anterior && (
          <button type="button" className="fech-link" disabled={salvando} aria-label={`Usar o saldo do banco de ${mesBR(conta.mes_anterior)} como saldo inicial de ${conta.nome}`} onClick={() => void gravar(sugestao)}>Usar {formatMoeda(sugestao)} (banco em {mesBR(conta.mes_anterior)})</button>
        )}
      </span>
    </div>
  );
}

function Pendencias({ dados, abrir, irParaComprovantes }: { dados: FechamentoApi; abrir: (id: string) => void; irParaComprovantes: () => void }) {
  const p = dados.pendencias;
  const todas = PENDENCIAS.map((m) => ({ ...m, ...p[m.chave] }));
  const comProblema = todas.filter((x) => x.quantidade > 0);
  return (
    <section className="fech-bloco cofre-rise" style={estiloI(4)} aria-label="Pendências do período">
      <header><h2>Pendências</h2></header>
      {comProblema.length === 0 && p.rascunhos === 0 ? (
        <div className="cofre-card fech-tudo-certo"><CheckCircle2 size={18} aria-hidden /><p><b>Nada pendente neste período.</b> Todos os lançamentos estão efetivados, com categoria, conta, comprovante e conciliados.</p></div>
      ) : (
        <div className="fech-pendencias">
          {comProblema.map((x) => (
            <article key={x.chave} className="cofre-card fech-pendencia" data-tom={x.gravidade}>
              <header>
                <h3>{x.titulo}</h3>
                <span className="fech-contagem cofre-mono">{x.quantidade}</span>
              </header>
              <p>{x.dica} <span className="cofre-mono">{formatMoeda(x.valor_centavos)}</span> no total.</p>
              <ul>
                {x.itens.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => abrir(i.id)} aria-label={`Abrir lançamento ${i.descricao}, ${formatBR(i.data)}`}>
                      <span className="fech-item-data cofre-mono">{formatBR(i.data).slice(0, 5)}</span>
                      <span className="fech-item-desc">{i.descricao}</span>
                      <span className="fech-item-valor cofre-mono" data-tipo={i.tipo}>{i.tipo === "saida" ? "−" : ""}{formatMoeda(i.valor_centavos)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {x.quantidade > x.itens.length && <small className="fech-mais">Mostrando os {x.itens.length} mais antigos de {x.quantidade}.</small>}
            </article>
          ))}
          {p.rascunhos > 0 && (
            <article className="cofre-card fech-pendencia" data-tom="atencao">
              <header><h3>Comprovantes esperando revisão</h3><span className="fech-contagem cofre-mono">{p.rascunhos}</span></header>
              <p>Foram enviados, mas ainda não viraram lançamento. Vale em qualquer período.</p>
              <button type="button" className="cofre-secondary" onClick={irParaComprovantes}><Paperclip size={14} aria-hidden />Revisar em Comprovantes</button>
            </article>
          )}
        </div>
      )}
    </section>
  );
}

function Categorias({ titulo, tom, grupos, total }: { titulo: string; tom: "pos" | "neg"; grupos: GrupoFechamento[]; total: number }) {
  return (
    <section className="fech-bloco cofre-rise" style={estiloI(5)} aria-label={titulo}>
      <header><h2>{titulo}</h2></header>
      <div className="cofre-card fech-lista">
        {grupos.length === 0 ? <p className="fech-vazio">Nada efetivado neste período.</p> : (
          <ul>
            {grupos.map((g) => (
              <li key={g.id ?? "sem"}>
                <div className="fech-cat"><span>{g.nome}<small>{plural(g.lancamentos, "lançamento", "lançamentos")}</small></span><b className="cofre-mono" data-tom={tom}>{formatMoeda(g.valor)}</b></div>
                {g.filhas.length > 0 && (
                  <ul className="fech-subs">
                    {g.filhas.map((f) => <li key={f.id ?? "direto"} className="fech-cat"><span>{f.nome}</span><b className="cofre-mono">{formatMoeda(f.valor)}</b></li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        {grupos.length > 0 && <footer className="fech-cat fech-total"><span>Total</span><b className="cofre-mono" data-tom={tom}>{formatMoeda(total)}</b></footer>}
      </div>
    </section>
  );
}
