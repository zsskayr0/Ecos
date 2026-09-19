import { useCallback, useEffect, useState } from "react";
const EVENTO = "ecos:avatar-equipe-atualizado";
const cache = new Map<string, string | undefined>();

export function definirAvatarEquipeLocal(id: string, arquivo: File) {
  const anterior = cache.get(id);
  if (anterior?.startsWith("blob:")) URL.revokeObjectURL(anterior);
  cache.set(id, URL.createObjectURL(arquivo));
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: id }));
}

export function useAvatarEquipe(id?: string) {
  const [url, setUrl] = useState<string | undefined>(() => id ? cache.get(id) : undefined);
  const recarregar = useCallback(() => setUrl(id ? cache.get(id) : undefined), [id]);
  useEffect(() => { recarregar(); }, [recarregar]);
  useEffect(() => {
    const atualizar = (evento: Event) => { if ((evento as CustomEvent<string>).detail === id) recarregar(); };
    window.addEventListener(EVENTO, atualizar);
    return () => window.removeEventListener(EVENTO, atualizar);
  }, [id, recarregar]);
  return url;
}
