import { useEffect, useState } from "react";
import { obterEstadoOffline, type EstadoOffline } from "./offline-store";

export interface Conectividade {
  /** Há rede no dispositivo e o servidor respondeu na última tentativa. */
  online: boolean;
  /** Alterações salvas no dispositivo aguardando envio. */
  pendentes: number;
  sincronizando: boolean;
}

function derivar(estado: EstadoOffline): Conectividade {
  const redeLocal = typeof navigator === "undefined" ? true : navigator.onLine;
  return { online: redeLocal && estado.servidorDisponivel, pendentes: estado.pendentes, sincronizando: estado.sincronizando };
}

/**
 * Conectividade percebida: combina `navigator.onLine` com o "heartbeat" implícito
 * das requisições (uma falha de rede marca o servidor como indisponível em
 * offline-store e o próximo sucesso o devolve).
 */
export function useConectividade(): Conectividade {
  const [estado, setEstado] = useState<Conectividade>(() => derivar(obterEstadoOffline()));
  useEffect(() => {
    const atualizar = () => setEstado(derivar(obterEstadoOffline()));
    window.addEventListener("ecos:offline-change", atualizar);
    window.addEventListener("online", atualizar);
    window.addEventListener("offline", atualizar);
    atualizar();
    return () => {
      window.removeEventListener("ecos:offline-change", atualizar);
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
    };
  }, []);
  return estado;
}

export function estaOnline(): boolean {
  return derivar(obterEstadoOffline()).online;
}
