import { useCallback, useEffect, useState } from "react";
import { equipes } from "./api";

/**
 * Foto da equipe, guardada no servidor (`/equipes/:id/avatar`). Carregada como
 * Blob autenticado (funciona no Tauri, onde `<img>` não manda o Bearer) e
 * invalidada pela `versao` (`avatar_atualizado_em`) que o servidor devolve.
 */
const EVENTO = "ecos:avatar-equipe-atualizado";
const fotos = new Map<string, string | undefined>();
const versoes = new Map<string, number | null | undefined>();
const carregando = new Map<string, Promise<string | undefined>>();

function aplicar(id: string, blob: Blob | null, versao: number | null | undefined): string | undefined {
  const anterior = fotos.get(id);
  const proxima = blob ? URL.createObjectURL(blob) : undefined;
  if (anterior?.startsWith("blob:") && anterior !== proxima) URL.revokeObjectURL(anterior);
  fotos.set(id, proxima);
  versoes.set(id, versao);
  return proxima;
}

async function carregar(id: string, versao: number | null | undefined, forcar: boolean): Promise<string | undefined> {
  if (versao === null) { aplicar(id, null, null); return undefined; } // o servidor informou que não há foto
  if (!forcar && fotos.has(id) && versoes.get(id) === versao) return fotos.get(id);
  const existente = carregando.get(id);
  if (existente) return existente;
  const promessa = equipes.obterAvatar(id).then((blob) => aplicar(id, blob, versao)).finally(() => carregando.delete(id));
  carregando.set(id, promessa);
  return promessa;
}

function avisar(id: string) { window.dispatchEvent(new CustomEvent(EVENTO, { detail: id })); }

/** Envia a foto nova ao servidor; quem exibe a foto recarrega sozinho. */
export async function enviarAvatarEquipe(id: string, arquivo: File): Promise<void> {
  await equipes.enviarAvatar(id, arquivo);
  versoes.delete(id);
  avisar(id);
}

export async function removerAvatarEquipe(id: string): Promise<void> {
  await equipes.removerAvatar(id);
  aplicar(id, null, null);
  avisar(id);
}

/** `versao`: `avatar_atualizado_em` da equipe (`null` = sem foto, `undefined` = ainda não informado). */
export function useAvatarEquipe(id?: string, versao?: number | null) {
  const [url, setUrl] = useState<string | undefined>(() => id ? fotos.get(id) : undefined);
  const recarregar = useCallback(async (forcar = false) => {
    if (!id) { setUrl(undefined); return; }
    try { setUrl(await carregar(id, versao, forcar)); }
    catch { setUrl((atual) => atual ?? fotos.get(id)); }
  }, [id, versao]);
  useEffect(() => { void recarregar(); }, [recarregar]);
  useEffect(() => {
    const atualizar = (evento: Event) => { if ((evento as CustomEvent<string>).detail === id) void recarregar(true); };
    window.addEventListener(EVENTO, atualizar);
    return () => window.removeEventListener(EVENTO, atualizar);
  }, [id, recarregar]);
  return url;
}
