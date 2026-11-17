import { useEffect, useState } from "react";
import { bloqueioDeMensalidade, vault, type EstadoCiclo, type MensalidadeDetalheApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { Casca } from "../recorrencias/Dialogos";
import { ReajusteModal, type ModoReajuste } from "./ReajusteModal";
import { dataBR, formatPercentual, nomeDoResidente } from "./formato";
import "./mensalidades.css";

export interface BloqueioPendente {
  recorrencia_id: string;
  ciclo: string;
  /** Refaz o que a pessoa tentou (concluir, efetivar) depois que o ciclo for resolvido. */
  repetir?: () => void | Promise<unknown>;
}

const EVENTO_BLOQUEIO = "ecos:mensalidade-bloqueio";

/**
 * Para telas que não têm onde desenhar o diálogo (envio de comprovante): se o erro é o bloqueio de reajuste, entrega-o
 * ao `BloqueioGlobal` e devolve `true`; senão devolve `false` e a tela mostra o erro como sempre.
 */
export function encaminharBloqueio(e: unknown): boolean {
  const b = bloqueioDeMensalidade(e);
  if (!b) return false;
  const evento = new CustomEvent(EVENTO_BLOQUEIO, { detail: { ...b, tratado: false } });
  window.dispatchEvent(evento);
  return evento.detail.tratado;
}

/** Ouve os bloqueios encaminhados e abre o diálogo. Pode haver mais de um montado: só o primeiro atende. */
export function BloqueioGlobal({ aoResolver }: { aoResolver?: () => void }) {
  const [bloqueio, setBloqueio] = useState<BloqueioPendente | null>(null);
  useEffect(() => {
    const ouvir = (e: Event) => {
      const d = (e as CustomEvent<{ recorrencia_id: string; ciclo: string; tratado: boolean }>).detail;
      if (d.tratado) return;
      d.tratado = true;
      setBloqueio({ recorrencia_id: d.recorrencia_id, ciclo: d.ciclo });
    };
    window.addEventListener(EVENTO_BLOQUEIO, ouvir);
    return () => window.removeEventListener(EVENTO_BLOQUEIO, ouvir);
  }, []);
  return bloqueio ? <BloqueioReajuste bloqueio={bloqueio} onClose={() => setBloqueio(null)} aoResolver={aoResolver} /> : null;
}

/** Selo com o estado de um ciclo. */
export function SeloEstado({ estado, children }: { estado: EstadoCiclo; children: React.ReactNode }) {
  return <span className="mens-selo" data-estado={estado}>{children}</span>;
}

/**
 * O servidor recusou efetivar um recebimento porque o reajuste daquele aniversário ainda não foi decidido. Explica o
 * motivo e resolve ali mesmo: registrar o reajuste ou manter o valor. Resolvido, repete a ação que tinha sido barrada.
 */
export function BloqueioReajuste({ bloqueio, onClose, aoResolver }: {
  bloqueio: BloqueioPendente;
  onClose: () => void;
  /** Chamado depois de gravar a decisão (e de repetir a ação, se houver). */
  aoResolver?: () => void;
}) {
  const [mensalidade, setMensalidade] = useState<MensalidadeDetalheApi | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [modo, setModo] = useState<ModoReajuste | null>(null);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    vault.mensalidades.obter(bloqueio.recorrencia_id)
      .then((m) => { if (vivo) setMensalidade(m); })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [bloqueio.recorrencia_id, tentativa]);

  if (modo && mensalidade) {
    return <ReajusteModal mensalidade={mensalidade} ciclo={bloqueio.ciclo} modoInicial={modo} onClose={onClose}
      onSalvo={() => { onClose(); void Promise.resolve(bloqueio.repetir?.()).finally(() => aoResolver?.()); }} />;
  }

  const ciclo = mensalidade?.ciclos.find((c) => c.ciclo === bloqueio.ciclo);
  return (
    <Casca titulo="Reajuste pendente" sobre={mensalidade ? nomeDoResidente(mensalidade).toUpperCase() : undefined} onClose={onClose} onSubmit={(e) => { e.preventDefault(); if (mensalidade) setModo("automatico"); else setTentativa((n) => n + 1); }}>
      <p className="cofre-rec-dialogo-resumo">
        Este recebimento ainda não pode ser concluído: o reajuste do aniversário de <b>{dataBR(bloqueio.ciclo)}</b> está sem decisão.
        Decida agora se a mensalidade sobe ou se fica como está. Depois disso o recebimento é concluído normalmente.
      </p>
      {erro && <p role="alert" className="cofre-rec-erro">{erro}</p>}
      {!mensalidade && !erro && <p role="status" className="cofre-rec-dica">Buscando os dados do contrato…</p>}
      {mensalidade && (
        <div className="cofre-rec-restante mens-bloqueio-resumo">
          <span>Mensalidade hoje <b className="cofre-mono">{formatMoeda(mensalidade.valor_atual_centavos)}</b></span>
          {ciclo?.valor_minimo_centavos != null && <span>Com o mínimo de {formatPercentual(mensalidade.percentual_minimo_bp)} <b className="cofre-mono" data-ativo>{formatMoeda(ciclo.valor_minimo_centavos)}</b></span>}
        </div>
      )}
      <footer className="mens-bloqueio-acoes">
        <button type="button" className="cofre-secondary" onClick={onClose}>Agora não</button>
        {mensalidade ? (
          <>
            <button type="button" className="cofre-secondary" onClick={() => setModo("mantido")}>Manter valor</button>
            <button className="cofre-solid" autoFocus>Registrar reajuste</button>
          </>
        ) : erro ? <button className="cofre-solid">Tentar novamente</button> : null}
      </footer>
    </Casca>
  );
}
