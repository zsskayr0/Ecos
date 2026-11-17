import { useEffect, useState, type FormEvent } from "react";
import { Repeat2 } from "lucide-react";
import { vault, type MensalidadeApi, type MensalidadeCandidataApi } from "@/lib/api";
import { formatMoeda, hojeISO } from "@/lib/format";
import { DatePicker } from "@/components/common/DatePicker";
import { SeletorEcos } from "@/components/common/SeletorEcos";
import { Casca } from "../recorrencias/Dialogos";
import { bpDoCampo, bpParaCampo, nomeDoResidente } from "./formato";

const nomeDaCandidata = (c: MensalidadeCandidataApi) => c.beneficiario_nome?.trim() || c.descricao;

/**
 * Cria a mensalidade a partir de uma recorrência de entrada que ainda não tem (sem `mensalidade`), ou edita o contrato
 * de uma que já existe. O servidor usa a mesma rota para os dois.
 */
export function ContratoModal({ mensalidade, onClose, onSalvo, irParaRecorrencias }: {
  /** Presente = editar o contrato; ausente = adicionar. */
  mensalidade?: MensalidadeApi;
  onClose: () => void;
  onSalvo: (m: MensalidadeApi) => void;
  irParaRecorrencias?: () => void;
}) {
  const editando = !!mensalidade;
  const [candidatas, setCandidatas] = useState<MensalidadeCandidataApi[] | null>(editando ? [] : null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [escolhida, setEscolhida] = useState("");
  const [dataBase, setDataBase] = useState(mensalidade?.data_base ?? "");
  const [ciclosDesde, setCiclosDesde] = useState(mensalidade?.ciclos_desde ?? hojeISO());
  const [minimo, setMinimo] = useState(bpParaCampo(mensalidade?.percentual_minimo_bp ?? 1000));
  const [avisoDias, setAvisoDias] = useState(String(mensalidade?.aviso_dias ?? 30));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (editando) return;
    let vivo = true;
    setErroCarga(null);
    setCandidatas(null);
    vault.mensalidades.candidatas()
      .then((c) => { if (vivo) setCandidatas(c); })
      .catch((e: Error) => { if (vivo) setErroCarga(e.message); });
    return () => { vivo = false; };
  }, [editando, tentativa]);

  function escolher(id: string) {
    setEscolhida(id);
    // A data de entrada costuma ser o início da recorrência; a pessoa corrige se não for.
    const c = candidatas?.find((x) => x.recorrencia_id === id);
    if (c) setDataBase(c.data_inicio);
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const id = mensalidade?.recorrencia_id ?? escolhida;
    const bp = bpDoCampo(minimo);
    const dias = /^\d{1,3}$/.test(avisoDias.trim()) ? Number(avisoDias.trim()) : null;
    if (!id) return setErro("Escolha de quem é a mensalidade.");
    if (!dataBase) return setErro("Informe a data de entrada do residente.");
    if (!ciclosDesde) return setErro("Informe a partir de quando controlar os reajustes.");
    if (bp === null || bp > 10000) return setErro("O reajuste mínimo deve ficar entre 0 e 100%.");
    if (dias === null || dias > 180) return setErro("Os dias de aviso devem ficar entre 0 e 180.");
    setOcupado(true);
    setErro(null);
    try {
      onSalvo(await vault.mensalidades.salvar(id, { data_base: dataBase, ciclos_desde: ciclosDesde, percentual_minimo_bp: bp, aviso_dias: dias }));
    } catch (err) { setErro((err as Error).message); setOcupado(false); }
  }

  const titulo = editando ? "Editar contrato" : "Adicionar mensalidade";
  const sobre = mensalidade ? nomeDoResidente(mensalidade).toUpperCase() : undefined;

  if (erroCarga) {
    return (
      <Casca titulo={titulo} onClose={onClose} onSubmit={(e) => { e.preventDefault(); setTentativa((n) => n + 1); }}>
        <p role="alert" className="cofre-rec-erro">{erroCarga}</p>
        <footer><button type="button" className="cofre-secondary" onClick={onClose}>Fechar</button><button className="cofre-solid">Tentar novamente</button></footer>
      </Casca>
    );
  }
  if (candidatas === null) {
    return (
      <Casca titulo={titulo} onClose={onClose} onSubmit={(e) => e.preventDefault()}>
        <p role="status" className="cofre-rec-dica">Procurando as recorrências que podem virar mensalidade…</p>
      </Casca>
    );
  }
  if (!editando && candidatas.length === 0) {
    return (
      <Casca titulo={titulo} onClose={onClose} onSubmit={(e) => { e.preventDefault(); irParaRecorrencias?.(); }}>
        <div className="mens-vazio-modal">
          <Repeat2 size={28} aria-hidden />
          <p>Primeiro, cadastre o que o residente paga</p>
          <small>A mensalidade nasce de uma recorrência de receita fixa (o valor que entra todo mês). Crie uma em Recorrências, com o residente como pagador, e volte aqui. As que já têm mensalidade não aparecem nesta lista.</small>
        </div>
        <footer><button type="button" className="cofre-secondary" onClick={onClose}>Fechar</button>{irParaRecorrencias && <button className="cofre-solid">Ir para Recorrências</button>}</footer>
      </Casca>
    );
  }

  return (
    <Casca titulo={titulo} sobre={sobre} onClose={onClose} ocupado={ocupado} onSubmit={enviar}>
      {!editando && (
        <div className="cofre-rec-campo">
          <span>De quem é a mensalidade</span>
          <SeletorEcos ariaLabel="Recorrência do residente" valor={escolhida} onChange={escolher} buscar={candidatas.length > 8}
            opcoes={[{ valor: "", rotulo: "Escolher…" }, ...candidatas.map((c) => ({ valor: c.recorrencia_id, rotulo: `${nomeDaCandidata(c)} · ${formatMoeda(c.valor_centavos)}` }))]} />
          <small className="cofre-rec-dica">Aparecem aqui as receitas fixas e ativas que ainda não têm mensalidade.</small>
        </div>
      )}
      <div className="mens-datas">
        <div className="cofre-launch-field cofre-launch-date"><span>Data de entrada do residente</span><DatePicker ariaLabel="Data de entrada" value={dataBase} onChange={setDataBase} /></div>
        <div className="cofre-launch-field cofre-launch-date"><span>Controlar reajustes a partir de</span><DatePicker ariaLabel="Controlar a partir de" value={ciclosDesde} onChange={setCiclosDesde} /></div>
        <small className="cofre-rec-dica">O reajuste é todo ano no aniversário da entrada. Aniversários anteriores à segunda data são considerados já resolvidos e não são cobrados de você.</small>
      </div>
      <div className="mens-par">
        <label className="cofre-rec-campo">
          <span>Reajuste mínimo (%)</span>
          <input className="ecos-input cofre-mono" value={minimo} inputMode="decimal" aria-label="Reajuste mínimo (%)" onChange={(e) => setMinimo(e.target.value)} />
        </label>
        <label className="cofre-rec-campo">
          <span>Avisar com quantos dias</span>
          <input className="ecos-input cofre-mono" value={avisoDias} inputMode="numeric" aria-label="Dias de antecedência do aviso" onChange={(e) => setAvisoDias(e.target.value)} />
        </label>
      </div>
      {erro && <p role="alert" className="cofre-rec-erro">{erro}</p>}
      <footer>
        <button type="button" className="cofre-secondary" onClick={onClose} disabled={ocupado}>Cancelar</button>
        <button className="cofre-solid" disabled={ocupado}>{ocupado ? "Salvando…" : editando ? "Salvar contrato" : "Adicionar mensalidade"}</button>
      </footer>
    </Casca>
  );
}
