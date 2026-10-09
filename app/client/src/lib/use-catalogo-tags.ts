import { useCallback, useEffect, useState } from "react";
import { tagsApi, type TagCatalogo } from "./api";
import { useRefreshBus } from "./refresh-bus";

/**
 * Catálogo único de tags (notas + tarefas) que a pessoa enxerga. Recarrega quando algo muda no app
 * (`versao` do refresh bus), então uma tag criada numa nota já aparece no editor de tarefas.
 */
export function useCatalogoTags(espaco?: string) {
  const { versao } = useRefreshBus();
  const [tags, setTags] = useState<TagCatalogo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [local, setLocal] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    tagsApi.listar(espaco)
      .then((r) => { if (vivo) { setTags(r); setErro(null); } })
      .catch((e: unknown) => { if (vivo) setErro(e instanceof Error ? e.message : "Não foi possível carregar as tags."); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [espaco, versao, local]);

  const recarregar = useCallback(() => setLocal((n) => n + 1), []);
  return { tags, carregando, erro, recarregar };
}
