import { useEffect, useState } from "react";
import { equipes as equipesApi } from "./api";
import { useRefreshBus } from "./refresh-bus";

export interface MinhaEquipe {
  id: string;
  nome: string;
  cargo: string;
}

/**
 * `GET /equipes` (seção 11.10) — usado pra rotular Nota/Tarefa de Equipe no
 * Feed/Notas sem duplicar a chamada em cada card. Reobserva `versao` do
 * refresh bus: sem isso, criar/entrar numa Equipe só aparecia no Drawer e
 * no Perfil depois de recarregar a página inteira (o hook buscava só uma
 * vez, no primeiro mount) — bug real, não intencional.
 */
export function useMinhasEquipes() {
  const [equipes, setEquipes] = useState<MinhaEquipe[]>([]);
  const [carregando, setCarregando] = useState(true);
  const { versao } = useRefreshBus();

  useEffect(() => {
    let vivo = true;
    equipesApi
      .listarMinhas()
      .then((lista) => {
        if (vivo) setEquipes(lista);
      })
      .catch(() => {
        if (vivo) setEquipes([]);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [versao]);

  return { equipes, carregando };
}
