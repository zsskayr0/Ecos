import { useEffect, useSyncExternalStore } from "react";
import { seguro, type PastaTrancada, type SeguroEstado } from "@/lib/api";

/**
 * Estado das pastas trancadas, compartilhado por todas as telas. Quem manda é o servidor (ele esconde o conteúdo e
 * responde 423); aqui só se guarda o que ele disse para desenhar cadeados e abrir o diálogo de senha.
 */
let atual: SeguroEstado | null = null;
const ouvintes = new Set<() => void>();

export function publicarEstadoSeguro(e: SeguroEstado | null) {
  atual = e;
  ouvintes.forEach((f) => f());
}

export async function recarregarSeguro(): Promise<SeguroEstado | null> {
  try { publicarEstadoSeguro(await seguro.status()); } catch { /* offline: mantém o último estado conhecido */ }
  return atual;
}

/** Estado atual (ou `null` até a primeira leitura). Relê quando o servidor responde 423 em algum lugar. */
export function usePastasTrancadas(): SeguroEstado | null {
  const estado = useSyncExternalStore((cb) => { ouvintes.add(cb); return () => { ouvintes.delete(cb); }; }, () => atual);
  useEffect(() => {
    if (atual === null) void recarregarSeguro();
    const aoTrancar = () => void recarregarSeguro();
    window.addEventListener("ecos:seguro-trancada", aoTrancar);
    return () => window.removeEventListener("ecos:seguro-trancada", aoTrancar);
  }, []);
  return estado;
}

/** A tranca que cobre `caminho` (a própria pasta ou uma ancestral), se houver. */
export function trancaQueCobre(estado: SeguroEstado | null, caminho: string): PastaTrancada | null {
  if (!estado || !caminho) return null;
  return estado.pastas.find((p) => caminho === p.pasta || caminho.startsWith(`${p.pasta}/`)) ?? null;
}

/** Muda quando alguma pasta abre ou fecha: as telas usam para recarregar a lista. */
export function assinaturaSeguro(estado: SeguroEstado | null): string {
  return estado ? estado.pastas.map((p) => `${p.pasta}:${p.aberta ? 1 : 0}`).join("|") : "";
}

const EVENTOS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
const PING_MS = 20_000;

/**
 * Enquanto alguma pasta está aberta, avisa o servidor que a pessoa continua usando o app (o prazo é de inatividade), e
 * relê o estado de tempos em tempos para o cadeado voltar a fechar na tela quando o prazo acabar.
 */
export function useManterPastasAbertas(estado: SeguroEstado | null) {
  const algumaAberta = !!estado && estado.pastas.some((p) => p.aberta);
  useEffect(() => {
    if (!algumaAberta) return;
    let ultimoPing = 0;
    const atividade = () => {
      if (document.visibilityState === "hidden") return;
      const agora = Date.now();
      if (agora - ultimoPing > PING_MS) {
        ultimoPing = agora;
        seguro.manter().then(publicarEstadoSeguro).catch(() => undefined);
      }
    };
    for (const e of EVENTOS) window.addEventListener(e, atividade, { passive: true, capture: true });
    const relogio = window.setInterval(() => void recarregarSeguro(), 30_000);
    const visivel = () => { if (document.visibilityState === "visible") void recarregarSeguro(); };
    document.addEventListener("visibilitychange", visivel);
    return () => {
      for (const e of EVENTOS) window.removeEventListener(e, atividade, { capture: true });
      window.clearInterval(relogio);
      document.removeEventListener("visibilitychange", visivel);
    };
  }, [algumaAberta]);
}

/** Primeiro motivo de campo inválido (ex.: "Senha incorreta.") ou a mensagem do erro. */
export function motivoSenha(e: unknown, padrao: string): string {
  const campos = (e as { campos?: { motivo: string }[] } | null)?.campos;
  if (campos?.length) return campos[0].motivo;
  const msg = (e as { message?: string } | null)?.message;
  return msg || padrao;
}
