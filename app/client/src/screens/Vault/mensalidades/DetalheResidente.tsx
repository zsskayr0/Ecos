import { useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Pencil, Trash2 } from "lucide-react";
import { vault, type CicloApi, type MensalidadeDetalheApi } from "@/lib/api";
import { formatMoeda, hojeISO } from "@/lib/format";
import { ErroLista } from "../cadastros/CadastroLista";
import { ConfirmarModal } from "../recorrencias/Dialogos";
import { ContratoModal } from "./ContratoModal";
import { ReajusteModal, type ModoReajuste } from "./ReajusteModal";
import { SeloEstado } from "./BloqueioReajuste";
import { dataBR, formatPercentual, nomeDoResidente, prazoPorExtenso, ROTULO_REGRA, rotuloDoEstado, semDecisao, vigenciaSeAvisarHoje } from "./formato";

const estiloI = (i: number) => ({ "--i": i }) as CSSProperties;

/** Contrato e histórico de um residente: cada aniversário com o que foi decidido, e o que ainda falta decidir. */
export function DetalheResidente({ recorrenciaId, onVoltar, aoMudar, avisar, recarregar = 0 }: {
  recorrenciaId: string;
  onVoltar: () => void;
  /** Algo foi gravado: a lista de fora precisa recarregar. */
  aoMudar: () => void;
  avisar: (texto: string) => void;
  recarregar?: number;
}) {
  const [dados, setDados] = useState<MensalidadeDetalheApi | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [reajuste, setReajuste] = useState<{ ciclo: string; modo: ModoReajuste } | null>(null);
  const [editando, setEditando] = useState(false);
  const [desfazer, setDesfazer] = useState<CicloApi | null>(null);
  const [removendo, setRemovendo] = useState(false);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    vault.mensalidades.obter(recorrenciaId)
      .then((d) => { if (vivo) setDados(d); })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [recorrenciaId, versao, recarregar]);

  const mudou = (texto: string) => { setVersao((v) => v + 1); aoMudar(); avisar(texto); };
  const hoje = hojeISO();

  return (
    <div className="mens-detalhe">
      <button type="button" className="cofre-secondary mens-voltar" onClick={onVoltar}><ArrowLeft size={14} aria-hidden />Todas as mensalidades</button>

      {erro && <ErroLista mensagem={erro} aoTentar={() => setVersao((v) => v + 1)} />}
      {!dados && !erro && <div className="cofre-cats-skeleton" role="status" aria-label="Carregando mensalidade">{[0, 1, 2].map((i) => <div key={i} style={estiloI(i)} />)}</div>}

      {dados && !erro && (
        <>
          <div className="cofre-card cofre-cats-card mens-contrato cofre-rise" style={estiloI(0)}>
            <div className="mens-contrato-topo">
              <div>
                <h2>{nomeDoResidente(dados)}</h2>
                <small>{dados.beneficiario_nome ? dados.descricao : "Recorrência sem pagador informado"}{!dados.ativa && " · recorrência pausada"}</small>
              </div>
              <b className="cofre-mono mens-contrato-valor">{formatMoeda(dados.valor_atual_centavos)}<small>por mês</small></b>
            </div>
            <div className="mens-contrato-dados">
              <Dado rotulo="Data de entrada" valor={dataBR(dados.data_base)} />
              <Dado rotulo="Reajustes controlados desde" valor={dataBR(dados.ciclos_desde)} />
              <Dado rotulo="Reajuste mínimo" valor={formatPercentual(dados.percentual_minimo_bp)} />
              <Dado rotulo="Aviso com antecedência de" valor={`${dados.aviso_dias} dias`} />
            </div>
            <div className="mens-contrato-acoes">
              <button type="button" className="cofre-secondary" onClick={() => setEditando(true)}><Pencil size={13} aria-hidden />Editar contrato</button>
              <button type="button" className="cofre-secondary" onClick={() => setRemovendo(true)}><Trash2 size={13} aria-hidden />Parar de controlar</button>
            </div>
          </div>

          <div className="cofre-card cofre-cats-card cofre-rise" style={estiloI(1)}>
            <h3 className="mens-titulo-secao">Aniversários e reajustes</h3>
            {dados.ciclos.length === 0 ? <p className="cofre-cats-none">Nenhum aniversário no período controlado ainda.</p> : (
              <ol className="mens-linha-tempo" aria-label="Linha do tempo dos reajustes">
                {dados.ciclos.map((c) => (
                  <li key={c.ciclo} data-estado={c.estado}>
                    <div className="mens-ciclo-topo">
                      <b>{dataBR(c.ciclo)}</b>
                      <SeloEstado estado={c.estado}>{rotuloDoEstado(c)}</SeloEstado>
                    </div>
                    {c.reajuste ? (
                      <>
                        <p className="mens-ciclo-valores cofre-mono">{formatMoeda(c.reajuste.valor_anterior_centavos)}<ArrowRight size={13} aria-hidden /><b>{formatMoeda(c.reajuste.valor_novo_centavos)}</b></p>
                        <p className="mens-ciclo-texto">
                          {ROTULO_REGRA[c.reajuste.regra]}{c.reajuste.regra !== "mantido" && <> de {formatPercentual(c.reajuste.percentual_bp)}</>}
                          {c.reajuste.regra !== "mantido" && <> · avisado em {dataBR(c.reajuste.aviso_em)} · vale desde {dataBR(c.reajuste.vigente_desde)}</>}
                        </p>
                        {c.reajuste.perda_centavos > 0 && <p className="mens-ciclo-perda">Perda pelo atraso: <b className="cofre-mono">{formatMoeda(c.reajuste.perda_centavos)}</b></p>}
                        {c.reajuste.motivo && <p className="mens-ciclo-motivo">“{c.reajuste.motivo}”</p>}
                        {c.reajuste.id && <div className="mens-ciclo-acoes"><button type="button" className="cofre-secondary" onClick={() => setDesfazer(c)}>Desfazer</button></div>}
                      </>
                    ) : (
                      <>
                        <p className="mens-ciclo-texto">
                          {c.estado === "atrasado" && <>O prazo do aviso era {dataBR(c.limite_aviso)} ({prazoPorExtenso(hoje, c.limite_aviso)}). Avise hoje e o novo valor vale a partir de {dataBR(vigenciaSeAvisarHoje(hoje, c.ciclo, dados.aviso_dias))}.</>}
                          {c.estado === "avisar" && <>Avise o residente até {dataBR(c.limite_aviso)} ({prazoPorExtenso(hoje, c.limite_aviso)}).</>}
                          {c.estado === "futuro" && <>Avisar até {dataBR(c.limite_aviso)}. Ainda há tempo.</>}
                          {c.valor_minimo_centavos != null && <> Com o mínimo, a mensalidade vai a <b className="cofre-mono">{formatMoeda(c.valor_minimo_centavos)}</b>.</>}
                        </p>
                        {!!c.perda_estimada_centavos && <p className="mens-ciclo-perda">Perda estimada se avisar hoje: <b className="cofre-mono">{formatMoeda(c.perda_estimada_centavos)}</b></p>}
                        {semDecisao(c) && (
                          <div className="mens-ciclo-acoes">
                            <button type="button" className={c.estado === "futuro" ? "cofre-secondary" : "cofre-solid"} onClick={() => setReajuste({ ciclo: c.ciclo, modo: "automatico" })}>Registrar reajuste</button>
                            <button type="button" className="cofre-secondary" onClick={() => setReajuste({ ciclo: c.ciclo, modo: "mantido" })}>Manter valor</button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}

      {reajuste && dados && <ReajusteModal mensalidade={dados} ciclo={reajuste.ciclo} modoInicial={reajuste.modo} onClose={() => setReajuste(null)}
        onSalvo={(r) => { setReajuste(null); mudou(r.regra === "mantido" ? "Valor mantido neste aniversário." : `Reajuste registrado: vale a partir de ${dataBR(r.vigente_desde)}.`); }} />}
      {editando && dados && <ContratoModal mensalidade={dados} onClose={() => setEditando(false)} onSalvo={() => { setEditando(false); mudou("Contrato atualizado."); }} />}
      {desfazer?.reajuste?.id && (
        <ConfirmarModal titulo="Desfazer esta decisão?" rotuloConfirmar="Desfazer"
          mensagem={<>A decisão do aniversário de <b>{dataBR(desfazer.ciclo)}</b> é apagada e o ciclo volta a ficar sem decisão. Use para corrigir um erro de digitação. Recebimentos já lançados não mudam.</>}
          onClose={() => setDesfazer(null)}
          onConfirmar={async () => { await vault.mensalidades.removerReajuste(desfazer.reajuste!.id!); setDesfazer(null); mudou("Decisão desfeita."); }} />
      )}
      {removendo && dados && (
        <ConfirmarModal titulo="Parar de controlar esta mensalidade?" rotuloConfirmar="Parar de controlar"
          mensagem={<><b>{nomeDoResidente(dados)}</b> sai de Mensalidades: sem avisos de reajuste e sem bloqueio. A recorrência continua gerando os recebimentos, e os reajustes já registrados ficam guardados.</>}
          onClose={() => setRemovendo(false)}
          onConfirmar={async () => { await vault.mensalidades.remover(dados.recorrencia_id); setRemovendo(false); aoMudar(); avisar("Mensalidade removida do controle."); onVoltar(); }} />
      )}
    </div>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return <div className="cofre-cats-spec"><span>{rotulo}</span><b>{valor}</b></div>;
}
