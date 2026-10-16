import { useEffect, useState } from "react";
import { equipes as equipesApi } from "./api";
import { useRefreshBus } from "./refresh-bus";
import { corLocalPendente, limparCorLocal, registrarCoresDasEquipes } from "./team-color";
import type { TipoEquipe } from "./tipo-equipe";

export interface MinhaEquipe {
  id: string;
  nome: string;
  cargo: string;
  tipo: TipoEquipe;
  /** Quantas pessoas a equipe tem (inclui quem está logado). */
  membros: number;
  /** Cor de identidade, a mesma em todos os aparelhos (vem do servidor). */
  cor?: string;
  /** `true` quando alguém já escolheu a cor no servidor (senão `cor` é a derivada do id). */
  cor_personalizada?: boolean;
  /** Versão da foto da equipe no servidor (`null` = sem foto); invalida o cache da imagem. */
  avatar_atualizado_em?: number | null;
}

/**
 * Cor escolhida neste aparelho antes de a cor existir no servidor: dono/admin a enviam uma vez e a cópia
 * local é descartada; para os demais cargos ela é só descartada (o servidor manda). Falha de rede mantém a cópia.
 */
function migrarCoresLocais(lista: MinhaEquipe[]) {
  for (const equipe of lista) {
    const pendente = corLocalPendente(equipe.id, equipe.cor);
    if (!pendente) { if (equipe.cor) limparCorLocal(equipe.id); continue; }
    if (equipe.cor_personalizada) { limparCorLocal(equipe.id); continue; } // o servidor já tem uma escolha: ela vale
    if (equipe.cargo !== "dono" && equipe.cargo !== "admin") { limparCorLocal(equipe.id); continue; }
    void equipesApi.atualizar(equipe.id, undefined, undefined, pendente)
      .then(() => { limparCorLocal(equipe.id); registrarCoresDasEquipes([{ id: equipe.id, cor: pendente.toUpperCase() }]); })
      .catch(() => { /* tenta de novo na próxima carga */ });
  }
}

/**
 * `GET /equipes` (section 11.10) — used to label a Team's Nota/Tarefa in
 * the Feed/Notas without duplicating the call in every card. Watches the
 * refresh bus's `versao`: without that, creating/joining a Team only
 * showed up in the Drawer and Profile after reloading the whole page (the
 * hook fetched only once, on first mount) — a real, unintentional bug.
 */
/** Janela em que consumidores montados juntos (Topbar, Feed, Drawer…) dividem a mesma requisição. */
const JANELA_COMPARTILHADA_MS = 1500;
let pedido: { versao: number; em: number; promessa: Promise<MinhaEquipe[]> } | null = null;
let ultima: MinhaEquipe[] = [];
let consumidores = 0;

/** Um único `GET /equipes` por versão do refresh-bus; a lista só muda de identidade quando o conteúdo muda. */
function obterEquipes(versao: number): Promise<MinhaEquipe[]> {
  const agora = Date.now();
  if (pedido && pedido.versao === versao && agora - pedido.em < JANELA_COMPARTILHADA_MS) return pedido.promessa;
  const promessa = equipesApi.listarMinhas().then((lista) => {
    registrarCoresDasEquipes(lista);
    migrarCoresLocais(lista);
    if (JSON.stringify(lista) !== JSON.stringify(ultima)) ultima = lista;
    return ultima;
  });
  pedido = { versao, em: agora, promessa };
  promessa.catch(() => { if (pedido?.promessa === promessa) pedido = null; });
  return promessa;
}

export function useMinhasEquipes() {
  const [equipes, setEquipes] = useState<MinhaEquipe[]>([]);
  const [carregando, setCarregando] = useState(true);
  const { versao } = useRefreshBus();

  useEffect(() => {
    let vivo = true;
    consumidores++;
    obterEquipes(versao)
      .then((lista) => { if (vivo) setEquipes(lista); })
      .catch(() => { if (vivo) setEquipes([]); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => {
      vivo = false;
      // Sem nenhum consumidor montado o pedido compartilhado não vale mais (evita dado velho ao remontar).
      if (--consumidores <= 0) { consumidores = 0; pedido = null; }
    };
  }, [versao]);

  return { equipes, carregando };
}
