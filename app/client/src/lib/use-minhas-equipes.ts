import { useEffect, useState } from "react";
import { equipes as equipesApi } from "./api";
import { useRefreshBus } from "./refresh-bus";
import type { TipoEquipe } from "./tipo-equipe";

export interface MinhaEquipe {
  id: string;
  nome: string;
  cargo: string;
  tipo: TipoEquipe;
  /** Quantas pessoas a equipe tem (inclui quem está logado). */
  membros: number;
}

/**
 * `GET /equipes` (section 11.10) — used to label a Team's Nota/Tarefa in
 * the Feed/Notas without duplicating the call in every card. Watches the
 * refresh bus's `versao`: without that, creating/joining a Team only
 * showed up in the Drawer and Profile after reloading the whole page (the
 * hook fetched only once, on first mount) — a real, unintentional bug.
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
