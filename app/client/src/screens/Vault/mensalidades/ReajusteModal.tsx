import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { vault, type MensalidadeApi, type ReajusteApi, type ReajustePayload } from "@/lib/api";
import { formatMoeda, hojeISO } from "@/lib/format";
import { DatePicker } from "@/components/common/DatePicker";
import { SegmentedSlide } from "@/components/common/SegmentedSlide";
import { Casca } from "../recorrencias/Dialogos";
import { centavosDoCampo } from "../recorrencias/ocorrencias";
import { bpDoCampo, dataBR, formatPercentual, nomeDoResidente, ROTULO_REGRA } from "./formato";

export type ModoReajuste = ReajustePayload["modo"];
type Contrato = Pick<MensalidadeApi, "recorrencia_id" | "descricao" | "beneficiario_nome" | "percentual_minimo_bp" | "aviso_dias">;

const ESPERA_PREVIA_MS = 350;

/**
 * Registra a decisão de um ciclo: reajuste automático (o maior entre o mínimo e o IGP-M), negociado ou manter o valor.
 * A conta é do servidor: cada mudança pede uma prévia (`simular: true`) e só o que a prévia mostrou é gravado.
 */
export function ReajusteModal({ mensalidade, ciclo, modoInicial = "automatico", onClose, onSalvo }: {
  mensalidade: Contrato;
  ciclo: string;
  modoInicial?: ModoReajuste;
  onClose: () => void;
  onSalvo: (r: ReajusteApi) => void;
}) {
  const [modo, setModo] = useState<ModoReajuste>(modoInicial);
  const [igpm, setIgpm] = useState("");
  const [negociarPor, setNegociarPor] = useState<"percentual" | "valor">("percentual");
  const [percentual, setPercentual] = useState("");
  const [valorFinal, setValorFinal] = useState("");
  const [avisoEm, setAvisoEm] = useState(hojeISO());
  const [vigenteDesde, setVigenteDesde] = useState("");
  const [motivo, setMotivo] = useState("");
  const [previa, setPrevia] = useState<ReajusteApi | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const pedido = useRef(0);

  /** O que falta preencher antes de dar para calcular; `null` quando já dá. */
  const falta = useMemo<string | null>(() => {
    if (modo === "automatico") return igpm.trim() && bpDoCampo(igpm) === null ? "Confira o IGP-M: use só números, como 6,52." : null;
    if (modo === "negociado") {
      if (negociarPor === "percentual") return !percentual.trim() ? "Informe o percentual combinado." : bpDoCampo(percentual) === null ? "Confira o percentual: use só números, como 8 ou 7,5." : null;
      return !valorFinal.trim() ? "Informe o valor combinado." : centavosDoCampo(valorFinal) === null ? "Confira o valor: use o formato 3.800,00." : null;
    }
    return null;
  }, [modo, igpm, negociarPor, percentual, valorFinal]);

  /** O corpo do pedido sem o motivo: o motivo não muda a conta, então digitar nele não refaz a prévia. */
  const calculo = useMemo<ReajustePayload | null>(() => {
    if (falta || !avisoEm) return null;
    const base: ReajustePayload = { ciclo, modo, aviso_em: avisoEm };
    if (modo === "automatico") { const bp = bpDoCampo(igpm); if (bp !== null) base.igpm_bp = bp; }
    if (modo === "negociado") {
      if (negociarPor === "percentual") base.percentual_bp = bpDoCampo(percentual)!;
      else base.valor_novo_centavos = centavosDoCampo(valorFinal)!;
    }
    // Manter o valor vale sempre a partir do próprio aniversário; não há data para escolher.
    if (modo !== "mantido" && vigenteDesde) base.vigente_desde = vigenteDesde;
    return base;
  }, [falta, ciclo, modo, igpm, negociarPor, percentual, valorFinal, avisoEm, vigenteDesde]);
  const chave = calculo ? JSON.stringify(calculo) : "";

  useEffect(() => {
    const meu = ++pedido.current;
    setPrevia(null);
    setErroPrevia(null);
    if (!calculo) { setCalculando(false); return; }
    setCalculando(true);
    const relogio = window.setTimeout(() => {
      // A prévia não precisa do motivo (o servidor só o exige ao gravar).
      vault.mensalidades.reajustar(mensalidade.recorrencia_id, { ...calculo, simular: true })
        .then((r) => { if (pedido.current === meu) { setPrevia(r); setCalculando(false); } })
        .catch((e: Error) => { if (pedido.current === meu) { setErroPrevia(e.message); setCalculando(false); } });
    }, ESPERA_PREVIA_MS);
    return () => window.clearTimeout(relogio);
  }, [chave, mensalidade.recorrencia_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const precisaMotivo = modo !== "automatico";
  const podeGravar = !!previa && !!calculo && !calculando && !ocupado && (!precisaMotivo || !!motivo.trim());

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!calculo || !previa) return;
    if (precisaMotivo && !motivo.trim()) { setErro("Escreva o motivo: ele fica registrado no histórico do residente."); return; }
    setOcupado(true);
    setErro(null);
    try {
      const r = await vault.mensalidades.reajustar(mensalidade.recorrencia_id, { ...calculo, ...(precisaMotivo ? { motivo: motivo.trim() } : {}), simular: false });
      onSalvo(r);
    } catch (err) { setErro((err as Error).message); setOcupado(false); }
  }

  const aumento = previa ? previa.valor_novo_centavos - previa.valor_anterior_centavos : 0;

  return (
    <Casca titulo={modo === "mantido" ? "Manter valor" : "Registrar reajuste"} sobre={nomeDoResidente(mensalidade).toUpperCase()} onClose={onClose} ocupado={ocupado} onSubmit={enviar}>
      <p className="cofre-rec-dialogo-resumo">Aniversário de <b>{dataBR(ciclo)}</b>. O contrato pede aviso com <b>{mensalidade.aviso_dias} dias</b> de antecedência e reajuste mínimo de <b>{formatPercentual(mensalidade.percentual_minimo_bp)}</b>.</p>

      <SegmentedSlide className="cofre-launch-slide cofre-slide mens-modos" ariaLabel="Como decidir este reajuste" value={modo} onChange={setModo} opcoes={[
        { value: "automatico", label: "Automático", cor: "cofre-blue" },
        { value: "negociado", label: "Negociado", cor: "cofre-pink" },
        { value: "mantido", label: "Manter valor", cor: "cofre-blue" },
      ]} />

      {modo === "automatico" && (
        <label className="cofre-rec-campo">
          <span>IGP-M acumulado em 12 meses (%)</span>
          <input className="ecos-input cofre-mono" value={igpm} inputMode="decimal" placeholder="Ex.: 6,52" aria-label="IGP-M acumulado (%)" onChange={(e) => setIgpm(e.target.value)} />
          <small className="cofre-rec-dica">Vale o maior entre o IGP-M e o mínimo do contrato. Sem o IGP-M, aplica o mínimo.</small>
        </label>
      )}

      {modo === "negociado" && (
        <>
          <div className="cofre-segmented mens-negociar" role="group" aria-label="Como foi combinado">
            <button type="button" aria-pressed={negociarPor === "percentual"} onClick={() => setNegociarPor("percentual")}>Por percentual</button>
            <button type="button" aria-pressed={negociarPor === "valor"} onClick={() => setNegociarPor("valor")}>Por valor final</button>
          </div>
          {negociarPor === "percentual" ? (
            <label className="cofre-rec-campo">
              <span>Percentual combinado (%)</span>
              <input className="ecos-input cofre-mono" value={percentual} inputMode="decimal" placeholder="Ex.: 8" aria-label="Percentual combinado (%)" onChange={(e) => setPercentual(e.target.value)} />
            </label>
          ) : (
            <label className="cofre-rec-campo">
              <span>Novo valor da mensalidade</span>
              <input className="ecos-input cofre-mono" value={valorFinal} inputMode="decimal" placeholder="Ex.: 3.800,00" aria-label="Novo valor da mensalidade" onChange={(e) => setValorFinal(e.target.value)} />
            </label>
          )}
        </>
      )}

      {modo === "mantido" ? (
        <p className="cofre-rec-dica">A mensalidade continua como está neste aniversário. O ciclo fica resolvido e o próximo reajuste é só no ano que vem.</p>
      ) : (
        <div className="mens-datas">
          <div className="cofre-launch-field cofre-launch-date"><span>Avisei o residente em</span><DatePicker ariaLabel="Data do aviso" value={avisoEm} onChange={setAvisoEm} /></div>
          <div className="cofre-launch-field cofre-launch-date"><span>Novo valor vale a partir de</span><DatePicker ariaLabel="Início do novo valor" value={vigenteDesde} onChange={setVigenteDesde} limpavel /></div>
          <small className="cofre-rec-dica">Deixe a segunda data em branco para usar a primeira possível: {mensalidade.aviso_dias} dias depois do aviso, nunca antes do aniversário.</small>
        </div>
      )}

      {precisaMotivo && (
        <label className="cofre-rec-campo">
          <span>Motivo</span>
          <textarea className="ecos-input" value={motivo} maxLength={500} aria-label="Motivo" placeholder={modo === "mantido" ? "Por que o valor não muda este ano?" : "O que foi combinado e por quê?"} onChange={(e) => setMotivo(e.target.value)} />
        </label>
      )}

      <div className="mens-previa" aria-live="polite" aria-label="Prévia do reajuste">
        {falta ? <p className="cofre-rec-dica">{falta}</p>
          : erroPrevia ? <p role="alert" className="cofre-rec-erro">{erroPrevia}</p>
          : !previa ? <p className="cofre-rec-dica" role="status">Calculando…</p>
          : (
            <>
              <div className="mens-previa-valores">
                <span><small>Hoje</small><b className="cofre-mono">{formatMoeda(previa.valor_anterior_centavos)}</b></span>
                <ArrowRight size={16} aria-hidden />
                <span><small>Novo valor</small><b className="cofre-mono" data-tom={aumento > 0 ? "pos" : undefined}>{formatMoeda(previa.valor_novo_centavos)}</b></span>
              </div>
              <dl className="mens-previa-lista">
                <div><dt>Regra aplicada</dt><dd>{ROTULO_REGRA[previa.regra]}{previa.regra !== "mantido" && <> · {formatPercentual(previa.percentual_bp)}</>}</dd></div>
                {previa.regra !== "mantido" && <div><dt>Primeira data possível</dt><dd>{dataBR(previa.vigencia_minima)}</dd></div>}
                <div><dt>Vale a partir de</dt><dd>{dataBR(previa.vigente_desde)}</dd></div>
                <div data-perda={previa.perda_centavos > 0 || undefined}><dt>Perda pelo atraso</dt><dd className="cofre-mono">{previa.perda_centavos > 0 ? formatMoeda(previa.perda_centavos) : "Nenhuma"}</dd></div>
              </dl>
              {previa.perda_centavos > 0 && <p className="cofre-rec-dica">É o que deixa de entrar entre o aniversário e a data em que o novo valor começa a valer.</p>}
            </>
          )}
      </div>

      {erro && <p role="alert" className="cofre-rec-erro">{erro}</p>}
      <footer>
        <button type="button" className="cofre-secondary" onClick={onClose} disabled={ocupado}>Cancelar</button>
        <button className="cofre-solid" disabled={!podeGravar}>{ocupado ? "Salvando…" : modo === "mantido" ? "Manter valor" : "Registrar reajuste"}</button>
      </footer>
    </Casca>
  );
}
