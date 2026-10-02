import { useEffect, useMemo, useState } from "react";
import { equipes as equipesApi } from "./api";
import { useAppUI } from "./ui-context";
import { useMinhasEquipes } from "./use-minhas-equipes";

/**
 * Quem criou cada registro do Cofre, só quando faz sentido: no Cofre de uma equipe com mais de uma pessoa.
 * `nomeDe` devolve `undefined` fora disso (Cofre pessoal, equipe de uma pessoa) ou quando o autor é desconhecido
 * (registros antigos, gerados pelo sistema, ex-membros), então a tela simplesmente não mostra nada.
 */
export function useAutoriaDoCofre() {
  const { espacoAtivo } = useAppUI();
  const { equipes } = useMinhasEquipes();
  const equipeId = espacoAtivo.startsWith("equipe:") ? espacoAtivo.slice(7) : null;
  const equipe = equipes.find((e) => e.id === equipeId);
  const ativo = !!equipe && equipe.membros > 1;
  const [nomes, setNomes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ativo || !equipeId) { setNomes({}); return; }
    let vivo = true;
    equipesApi.listarMembros(equipeId)
      .then((lista) => { if (vivo) setNomes(Object.fromEntries(lista.map((m) => [m.usuario_id, m.nome || "Membro"]))); })
      .catch(() => { if (vivo) setNomes({}); });
    return () => { vivo = false; };
  }, [ativo, equipeId]);

  return useMemo(() => ({
    ativo,
    nomeDe: (criadoPor?: string | null): string | undefined => (ativo && criadoPor ? nomes[criadoPor] : undefined),
  }), [ativo, nomes]);
}
