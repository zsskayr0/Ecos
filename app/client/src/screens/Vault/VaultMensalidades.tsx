import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AlarmClock, CheckCircle2, HandCoins, LayoutList, Plus, Search, Table2, TriangleAlert, X } from "lucide-react";
import { vault, type MensalidadeApi } from "@/lib/api";
import { formatMoeda, hojeISO } from "@/lib/format";
import { casaBusca } from "@/lib/texto-busca";
import { SegmentedSlide } from "@/components/common/SegmentedSlide";
import { PeriodPicker } from "./nexus/PeriodPicker";
import { periodRange, type Period } from "./nexus/period";
import { ErroLista, Vazio } from "./cadastros/CadastroLista";
import "./recorrencias/recorrencias.css";
import "./mensalidades/mensalidades.css";
import { SeloEstado } from "./mensalidades/BloqueioReajuste";
import { ContratoModal } from "./mensalidades/ContratoModal";
import { DetalheResidente } from "./mensalidades/DetalheResidente";
import { PrevistoRecebido } from "./mensalidades/PrevistoRecebido";
import { ReajusteModal, type ModoReajuste } from "./mensalidades/ReajusteModal";
import { dataBR, formatPercentual, nomeDoResidente, prazoPorExtenso, rotuloDoEstado, vigenciaSeAvisarHoje } from "./mensalidades/formato";

type Visao = "painel" | "previsto";
const estiloI = (i: number) => ({ "--i": i }) as CSSProperties;

/**
 * Mensalidades dos residentes. No topo, o que exige ação: reajustes atrasados (com o que já se perdeu) e os que
 * precisam de aviso (com o prazo). Abaixo, todos os residentes; e a visão do que era previsto contra o que entrou.
 */
export function VaultMensalidades({ period, onPeriodChange, atualizar, recarregar, irParaRecorrencias }: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  atualizar: () => void;
  recarregar: number;
  irParaRecorrencias?: () => void;
}) {
  const { from: de, to: ate } = periodRange(period);
  const [visao, setVisao] = useState<Visao>("painel");
  const [lista, setLista] = useState<MensalidadeApi[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  const [reajuste, setReajuste] = useState<{ m: MensalidadeApi; ciclo: string; modo: ModoReajuste } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const avisoTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    vault.mensalidades.listar()
      .then((l) => { if (vivo) setLista(l); })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [versao, recarregar]);
  useEffect(() => () => window.clearTimeout(avisoTimer.current), []);

  function avisar(texto: string) {
    setAviso(texto);
    window.clearTimeout(avisoTimer.current);
    avisoTimer.current = window.setTimeout(() => setAviso(null), 5000);
  }
  /** Algo foi gravado: recarrega esta tela e avisa o resto do Cofre (o valor da recorrência pode ter mudado). */
  const mudou = () => { setVersao((v) => v + 1); atualizar(); };

  const hoje = hojeISO();
  const atrasados = useMemo(() => (lista ?? []).filter((m) => m.ciclo_em_foco?.estado === "atrasado"), [lista]);
  const aAvisar = useMemo(() => (lista ?? []).filter((m) => m.ciclo_em_foco?.estado === "avisar"), [lista]);
  const perdaTotal = atrasados.reduce((s, m) => s + (m.ciclo_em_foco?.perda_estimada_centavos ?? 0), 0);
  const filtrados = useMemo(() => (lista ?? []).filter((m) => casaBusca(busca, nomeDoResidente(m), m.descricao)), [lista, busca]);

  const carregando = lista === null && !erro;
  const vazio = lista !== null && lista.length === 0;
  const pedirReajuste = (m: MensalidadeApi, modo: ModoReajuste) => { if (m.ciclo_em_foco) setReajuste({ m, ciclo: m.ciclo_em_foco.ciclo, modo }); };

  return (
    <section className="cofre-cats cofre-rec mens">
      <div className="cofre-cats-top cofre-rise" style={estiloI(0)}>
        <h1>Mensalidades</h1>
        <div className="cofre-cats-actions">
          {!aberto && (
            <SegmentedSlide className="cofre-launch-slide cofre-slide" tamanho="lg" ariaLabel="Visão de mensalidades" value={visao} onChange={setVisao} opcoes={[
              { value: "painel", label: <span className="inline-flex items-center gap-1.5"><LayoutList size={14} aria-hidden />Residentes</span>, cor: "cofre-blue", ariaLabel: "Residentes" },
              { value: "previsto", label: <span className="inline-flex items-center gap-1.5"><Table2 size={14} aria-hidden />Previsto × recebido</span>, cor: "cofre-pink", ariaLabel: "Previsto × recebido" },
            ]} />
          )}
          {!aberto && visao === "previsto" && <PeriodPicker value={period} onChange={onPeriodChange} />}
          <button type="button" className="cofre-new-button" onClick={() => setAdicionando(true)}><Plus size={14} />Adicionar mensalidade</button>
        </div>
      </div>

      <p role="status" className="cofre-rec-faixa" data-vazia={!aviso || undefined}>{aviso}</p>

      {aberto ? (
        <DetalheResidente recorrenciaId={aberto} onVoltar={() => setAberto(null)} aoMudar={mudou} avisar={avisar} recarregar={recarregar} />
      ) : visao === "previsto" ? (
        <PrevistoRecebido de={de} ate={ate} recarregar={versao + recarregar} aoAbrir={setAberto} />
      ) : (
        <>
          {erro && <ErroLista mensagem={erro} aoTentar={() => setVersao((v) => v + 1)} />}
          {carregando && <div className="cofre-cats-skeleton" role="status" aria-label="Carregando mensalidades">{[0, 1, 2].map((i) => <div key={i} style={estiloI(i)} />)}</div>}

          {vazio && !erro && (
            <Vazio icone={<HandCoins size={30} aria-hidden />} titulo="Nenhuma mensalidade cadastrada"
              texto="Adicione a mensalidade de cada residente para o Cofre avisar a tempo do reajuste anual, impedir que o aniversário passe sem decisão e mostrar o que entrou contra o previsto."
              acao={<button type="button" className="cofre-new-button" onClick={() => setAdicionando(true)}><Plus size={14} />Adicionar mensalidade</button>} />
          )}

          {lista !== null && lista.length > 0 && !erro && (
            <>
              <section className="mens-acao cofre-rise" style={estiloI(1)} aria-label="Precisa de você">
                {atrasados.length === 0 && aAvisar.length === 0 ? (
                  <div className="cofre-card mens-tudo-certo"><CheckCircle2 size={18} aria-hidden /><p><b>Nenhum reajuste esperando por você.</b> Quando um aniversário se aproximar, ele aparece aqui com o prazo do aviso.</p></div>
                ) : (
                  <>
                    {atrasados.length > 0 && (
                      <div className="mens-grupo" data-tom="atrasado">
                        <header>
                          <h2><TriangleAlert size={15} aria-hidden />{atrasados.length === 1 ? "1 aviso de reajuste atrasado" : `${atrasados.length} avisos de reajuste atrasados`}</h2>
                          {perdaTotal > 0 && <p title="O que deixa de entrar entre cada aniversário e a primeira data em que o novo valor pode valer, avisando hoje.">Perda estimada se avisar hoje: <b className="cofre-mono">{formatMoeda(perdaTotal)}</b></p>}
                        </header>
                        <div className="mens-cartoes">
                          {atrasados.map((m) => (
                            <article key={m.recorrencia_id} className="cofre-card mens-cartao" data-tom="atrasado" aria-label={`Aviso atrasado de ${nomeDoResidente(m)}`}>
                              <button type="button" className="cofre-rec-titulo" onClick={() => setAberto(m.recorrencia_id)}>{nomeDoResidente(m)}</button>
                              <p className="mens-cartao-perda"><small>Perda estimada se avisar hoje</small><b className="cofre-mono">{formatMoeda(m.ciclo_em_foco!.perda_estimada_centavos ?? 0)}</b></p>
                              <p className="mens-cartao-texto">Aniversário em {dataBR(m.ciclo_em_foco!.ciclo)}. O aviso devia ter saído até {dataBR(m.ciclo_em_foco!.limite_aviso)}. <b>Avise hoje</b> e o novo valor vale a partir de <b>{dataBR(vigenciaSeAvisarHoje(hoje, m.ciclo_em_foco!.ciclo, m.aviso_dias))}</b>; cada dia de espera empurra essa data.{m.ciclos_sem_decisao > 1 && <> Há {m.ciclos_sem_decisao} aniversários sem decisão.</>}</p>
                              <div className="mens-cartao-acoes">
                                <button type="button" className="cofre-solid" onClick={() => pedirReajuste(m, "automatico")}>Registrar reajuste</button>
                                <button type="button" className="cofre-secondary" onClick={() => pedirReajuste(m, "mantido")}>Manter valor</button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                    {aAvisar.length > 0 && (
                      <div className="mens-grupo" data-tom="avisar">
                        <header><h2><AlarmClock size={15} aria-hidden />{aAvisar.length === 1 ? "1 residente para avisar" : `${aAvisar.length} residentes para avisar`}</h2></header>
                        <div className="mens-cartoes">
                          {aAvisar.map((m) => (
                            <article key={m.recorrencia_id} className="cofre-card mens-cartao" data-tom="avisar" aria-label={`Aviso de reajuste de ${nomeDoResidente(m)}`}>
                              <button type="button" className="cofre-rec-titulo" onClick={() => setAberto(m.recorrencia_id)}>{nomeDoResidente(m)}</button>
                              <p className="mens-cartao-prazo"><small>Avisar até</small><b>{dataBR(m.ciclo_em_foco!.limite_aviso)}</b><em>{prazoPorExtenso(hoje, m.ciclo_em_foco!.limite_aviso)}</em></p>
                              <p className="mens-cartao-texto">Aniversário em {dataBR(m.ciclo_em_foco!.ciclo)}.{m.ciclo_em_foco!.valor_minimo_centavos != null && <> Com o mínimo de {formatPercentual(m.percentual_minimo_bp)}, vai de {formatMoeda(m.valor_atual_centavos)} para <b className="cofre-mono">{formatMoeda(m.ciclo_em_foco!.valor_minimo_centavos)}</b>.</>}</p>
                              <div className="mens-cartao-acoes">
                                <button type="button" className="cofre-solid" onClick={() => pedirReajuste(m, "automatico")}>Registrar reajuste</button>
                                <button type="button" className="cofre-secondary" onClick={() => pedirReajuste(m, "mantido")}>Manter valor</button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>

              <div className="mens-residentes cofre-rise" style={estiloI(2)}>
                <div className="cofre-cats-list-head"><h3>Residentes</h3><span>{lista.length} {lista.length === 1 ? "mensalidade" : "mensalidades"}</span></div>
                <label className="cofre-cats-search"><Search size={13} aria-hidden /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar residente…" aria-label="Buscar residente" />{busca && <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")}><X size={12} /></button>}</label>
                <div className="cofre-card cofre-cats-list">
                  {filtrados.length === 0 && <p className="cofre-cats-none">Nenhum residente com esse nome.</p>}
                  {filtrados.map((m, i) => {
                    const foco = m.ciclo_em_foco;
                    return (
                      <div key={m.recorrencia_id} role="button" tabIndex={0} aria-label={`Abrir ${nomeDoResidente(m)}`} className="cofre-cats-row mens-linha" style={estiloI(Math.min(i, 12))}
                        onClick={() => setAberto(m.recorrencia_id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAberto(m.recorrencia_id); } }}>
                        <span className="cofre-sacados-avatar" aria-hidden>{nomeDoResidente(m).charAt(0).toUpperCase() || "?"}</span>
                        <span className="cofre-cats-row-main">
                          <span className="cofre-cats-row-name"><b>{nomeDoResidente(m)}</b></span>
                          <small>{foco ? `Aniversário em ${dataBR(foco.ciclo)}` : "Sem aniversário previsto"}{!m.ativa && " · recorrência pausada"}</small>
                        </span>
                        {foco && <SeloEstado estado={foco.estado}>{rotuloDoEstado(foco)}</SeloEstado>}
                        <b className="cofre-mono mens-linha-valor">{formatMoeda(m.valor_atual_centavos)}</b>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {adicionando && <ContratoModal onClose={() => setAdicionando(false)} irParaRecorrencias={irParaRecorrencias}
        onSalvo={(m) => { setAdicionando(false); mudou(); avisar(`Mensalidade de ${nomeDoResidente(m)} adicionada.`); setVisao("painel"); setAberto(m.recorrencia_id); }} />}
      {reajuste && <ReajusteModal mensalidade={reajuste.m} ciclo={reajuste.ciclo} modoInicial={reajuste.modo} onClose={() => setReajuste(null)}
        onSalvo={(r) => { setReajuste(null); mudou(); avisar(r.regra === "mantido" ? "Valor mantido neste aniversário." : `Reajuste registrado: vale a partir de ${dataBR(r.vigente_desde)}.`); }} />}
    </section>
  );
}
