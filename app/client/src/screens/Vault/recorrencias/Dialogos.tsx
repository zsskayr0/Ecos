import { DatePicker } from "@/components/common/DatePicker";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { formatMoeda } from "@/lib/format";
import { centavosDoCampo, centavosParaCampo, type LinhaRecorrencia } from "./ocorrencias";

const dataBR = (iso: string) => iso.split("-").reverse().join("/");

/** Casca comum: fundo escurecido, Esc e clique fora fecham (a menos que esteja ocupado). */
function Casca({ titulo, sobre, onClose, ocupado, children, onSubmit }: {
  titulo: string; sobre?: string; onClose: () => void; ocupado?: boolean; children: ReactNode; onSubmit: (e: FormEvent) => void;
}) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) onClose(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onClose, ocupado]);
  return (
    <div className="cofre-cats-modal">
      <div className="cofre-cats-backdrop" onClick={() => { if (!ocupado) onClose(); }} />
      <form className="cofre-card cofre-cats-dialog cofre-rec-dialogo" role="dialog" aria-modal="true" aria-label={titulo} onSubmit={onSubmit}>
        <header>
          <div>{sobre && <p>{sobre}</p>}<h2>{titulo}</h2></div>
          <button type="button" aria-label="Fechar" onClick={onClose} disabled={ocupado}><X size={16} /></button>
        </header>
        {children}
      </form>
    </div>
  );
}

/** Conclui só uma parte: lança o que foi pago/recebido e deixa o restante como pendência ligada à recorrência. */
export function ConclusaoParcialModal({ linha, onClose, onConfirmar }: {
  linha: LinhaRecorrencia; onClose: () => void; onConfirmar: (valorCentavos: number) => Promise<void>;
}) {
  const cheio = linha.valorCentavos;
  const entrada = linha.regra.tipo === "entrada";
  const [texto, setTexto] = useState(centavosParaCampo(cheio));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pago = centavosDoCampo(texto);
  const restante = pago === null ? null : cheio - pago;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (pago === null) return setErro("Informe um valor válido.");
    if (pago >= cheio) return setErro("Esse é o valor cheio — use “Concluir” em vez de parcial.");
    setOcupado(true);
    setErro(null);
    try { await onConfirmar(pago); }
    catch (err) { setErro((err as Error).message); setOcupado(false); }
  }

  return (
    <Casca titulo="Concluir parcialmente" sobre={linha.regra.descricao.toUpperCase()} onClose={onClose} ocupado={ocupado} onSubmit={enviar}>
      <p className="cofre-rec-dialogo-resumo">Vencimento {dataBR(linha.data)} · Total <b className="cofre-mono">{formatMoeda(cheio)}</b></p>
      <label className="cofre-rec-campo">
        <span>{entrada ? "Quanto foi recebido" : "Quanto foi pago"}</span>
        <input className="ecos-input cofre-mono" value={texto} inputMode="decimal" autoFocus aria-label={entrada ? "Valor recebido" : "Valor pago"} onChange={(e) => setTexto(e.target.value)} />
      </label>
      <div className="cofre-rec-restante"><span>Fica pendente</span><b className="cofre-mono" data-ativo={(restante ?? 0) > 0 || undefined}>{formatMoeda(Math.max(0, restante ?? 0))}</b></div>
      <p className="cofre-rec-dica">O restante vira uma pendência sem data, ligada a esta recorrência. Ela aparece no Fluxo de Trabalho até você decidir quando lançar.</p>
      {erro && <p role="alert" className="cofre-rec-erro">{erro}</p>}
      <footer><button type="button" className="cofre-secondary" onClick={onClose} disabled={ocupado}>Cancelar</button><button className="cofre-solid" disabled={ocupado}>{ocupado ? "Salvando…" : "Confirmar conclusão parcial"}</button></footer>
    </Casca>
  );
}

/** Escolhe outra data para a ocorrência, sem efetivar. */
export function ReagendarModal({ linha, atual, onClose, onConfirmar }: {
  linha: LinhaRecorrencia; atual: string; onClose: () => void; onConfirmar: (data: string) => Promise<void>;
}) {
  const [data, setData] = useState(atual);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!data) return setErro("Escolha uma data.");
    setOcupado(true);
    setErro(null);
    try { await onConfirmar(data); }
    catch (err) { setErro((err as Error).message); setOcupado(false); }
  }

  return (
    <Casca titulo="Reagendar" sobre={linha.regra.descricao.toUpperCase()} onClose={onClose} ocupado={ocupado} onSubmit={enviar}>
      <p className="cofre-rec-dialogo-resumo">Vencimento original {dataBR(linha.data)}. A recorrência continua nos dias de sempre; só esta ocorrência muda.</p>
      <div className="cofre-launch-field cofre-launch-date"><span>Nova data</span><DatePicker ariaLabel="Nova data" value={data} onChange={setData} /></div>
      {erro && <p role="alert" className="cofre-rec-erro">{erro}</p>}
      <footer><button type="button" className="cofre-secondary" onClick={onClose} disabled={ocupado}>Cancelar</button><button className="cofre-solid" disabled={ocupado || !data}>{ocupado ? "Salvando…" : "Reagendar"}</button></footer>
    </Casca>
  );
}

export function ConfirmarModal({ titulo, mensagem, rotuloConfirmar, perigo = true, onClose, onConfirmar }: {
  titulo: string; mensagem: ReactNode; rotuloConfirmar: string; perigo?: boolean; onClose: () => void; onConfirmar: () => Promise<void>;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try { await onConfirmar(); }
    catch (err) { setErro((err as Error).message); setOcupado(false); }
  }

  return (
    <Casca titulo={titulo} onClose={onClose} ocupado={ocupado} onSubmit={enviar}>
      <div className="cofre-rec-dialogo-resumo">{mensagem}</div>
      {erro && <p role="alert" className="cofre-rec-erro">{erro}</p>}
      <footer>
        <button type="button" className="cofre-secondary" onClick={onClose} disabled={ocupado} autoFocus>Cancelar</button>
        <button className={perigo ? "cofre-rec-perigo" : "cofre-solid"} disabled={ocupado}>{ocupado ? "Aguarde…" : rotuloConfirmar}</button>
      </footer>
    </Casca>
  );
}

export type EscopoEdicao = "esta" | "proximas" | "todas";

/** Pergunta até onde vale a edição: só esta ocorrência, esta e as próximas, ou a recorrência inteira. */
export function EscopoEdicaoModal({ descricao, dataOcorrencia, permitirProximas, onClose, onConfirmar }: {
  descricao: string; dataOcorrencia: string; permitirProximas: boolean; onClose: () => void; onConfirmar: (escopo: EscopoEdicao) => Promise<void>;
}) {
  const [escopo, setEscopo] = useState<EscopoEdicao>("esta");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const opcoes: { valor: EscopoEdicao; rotulo: string; ajuda: string; ativa: boolean }[] = [
    { valor: "esta", rotulo: "Só esta ocorrência", ajuda: `Muda apenas o lançamento de ${dataBR(dataOcorrencia)}; o resto continua como está.`, ativa: true },
    { valor: "proximas", rotulo: "Esta e as próximas", ajuda: "A recorrência é dividida: as anteriores ficam como estão e daqui para a frente vale o novo jeito.", ativa: permitirProximas },
    { valor: "todas", rotulo: "Todas", ajuda: "Muda a regra inteira. Lançamentos que já existem não são alterados.", ativa: true },
  ];

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try { await onConfirmar(escopo); }
    catch (err) { setErro((err as Error).message); setOcupado(false); }
  }

  return (
    <Casca titulo="Aplicar a quais ocorrências?" sobre={descricao.toUpperCase()} onClose={onClose} ocupado={ocupado} onSubmit={enviar}>
      <div className="cofre-rec-escopos" role="radiogroup" aria-label="Alcance da edição">
        {opcoes.filter((o) => o.ativa).map((o) => (
          <label key={o.valor} className="cofre-rec-escopo" data-sel={escopo === o.valor || undefined}>
            <input type="radio" name="escopo" value={o.valor} checked={escopo === o.valor} onChange={() => setEscopo(o.valor)} />
            <span>{o.rotulo}<small>{o.ajuda}</small></span>
          </label>
        ))}
      </div>
      {erro && <p role="alert" className="cofre-rec-erro">{erro}</p>}
      <footer><button type="button" className="cofre-secondary" onClick={onClose} disabled={ocupado}>Cancelar</button><button className="cofre-solid" disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar alterações"}</button></footer>
    </Casca>
  );
}
