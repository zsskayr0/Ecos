import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { ApiError, assinarContextoCofre, chaveContextoCofre, geracaoDoCofre, vault, type FormaPagamentoApi } from "./api";
import { rotuloForma } from "./formas-pagamento";

/**
 * Cadastro de formas de pagamento compartilhado por todas as telas (uma carga, vários consumidores).
 *
 * - O cache vale para uma identidade (servidor + usuário + espaço); mudou, limpa tudo.
 * - Bloqueio do Cofre limpa e descarta o que estiver em voo; não recarrega sozinho.
 * - `carregar(true)` é o caminho obrigatório após mutação: ignora o TTL e refaz mesmo se a anterior falhou.
 */
interface Estado {
  chave: string;
  lista: FormaPagamentoApi[] | null;
  carregando: boolean;
  erro: string | null;
  carregadoEm: number;
}

const TTL_MS = 30_000;
const vazio = (chave: string): Estado => ({ chave, lista: null, carregando: false, erro: null, carregadoEm: 0 });

let estado: Estado = vazio(chaveContextoCofre());
let emVoo: Promise<void> | null = null;
let consumidores = 0;
const ouvintes = new Set<() => void>();
let descontextos: (() => void) | null = null;

function definir(parcial: Partial<Estado>) {
  estado = { ...estado, ...parcial };
  ouvintes.forEach((cb) => cb());
}

/** A lista como está agora (para conferir o resultado de uma operação depois de `carregar(true)`); `null` se não chegou. */
export function formasAtuais(): FormaPagamentoApi[] | null {
  return estado.chave === chaveContextoCofre() ? estado.lista : null;
}

/** Para testes: volta ao estado inicial. */
export function reiniciarFormasPagamento() {
  emVoo = null;
  estado = vazio(chaveContextoCofre());
  ouvintes.forEach((cb) => cb());
}

function aoMudarContexto() {
  const chave = chaveContextoCofre();
  const mudouIdentidade = chave !== estado.chave;
  emVoo = null; // o que estava em voo pertence ao contexto anterior e será descartado
  estado = vazio(chave);
  ouvintes.forEach((cb) => cb());
  if (mudouIdentidade && consumidores > 0) void carregar(true);
}

async function executar(): Promise<void> {
  const chave = chaveContextoCofre();
  const geracao = geracaoDoCofre();
  if (chave !== estado.chave) estado = vazio(chave);
  definir({ carregando: true });
  const minha = (async () => {
    try {
      const lista = await vault.formasPagamento.listar();
      if (chave !== chaveContextoCofre() || geracao !== geracaoDoCofre()) return; // contexto mudou: resultado descartado
      definir({ lista, erro: null, carregando: false, carregadoEm: Date.now(), chave });
    } catch (e) {
      if (chave !== chaveContextoCofre() || geracao !== geracaoDoCofre()) return;
      if (e instanceof ApiError && e.code === "VAULT_LOCKED") { definir({ carregando: false }); return; }
      definir({ carregando: false, erro: e instanceof ApiError ? e.message : "Não foi possível carregar as formas de pagamento." });
    }
  })();
  emVoo = minha;
  await minha;
  if (emVoo === minha) emVoo = null;
}

/** `forcar` = após mutação: espera a carga em voo (mesmo que falhe) e refaz. */
export async function carregar(forcar = false): Promise<void> {
  if (chaveContextoCofre() !== estado.chave) estado = vazio(chaveContextoCofre());
  if (!forcar) {
    if (emVoo) return emVoo;
    if (estado.lista && Date.now() - estado.carregadoEm < TTL_MS) return;
    return executar();
  }
  if (emVoo) { try { await emVoo; } catch { /* a anterior falhou: refaz mesmo assim */ } }
  return executar();
}

function aoFocar() { if (consumidores > 0) void carregar(true); }

function assinar(cb: () => void) {
  ouvintes.add(cb);
  if (consumidores++ === 0) {
    descontextos = assinarContextoCofre(aoMudarContexto);
    window.addEventListener("focus", aoFocar);
  }
  return () => {
    ouvintes.delete(cb);
    if (--consumidores === 0) {
      descontextos?.();
      descontextos = null;
      window.removeEventListener("focus", aoFocar);
    }
  };
}

export interface FormasPagamento {
  /** Todas, inclusive inativas, na ordem do servidor. */
  lista: FormaPagamentoApi[];
  ativas: FormaPagamentoApi[];
  porCodigo: Map<string, FormaPagamentoApi>;
  /** Primeira carga em andamento (sem nada em cache). */
  carregando: boolean;
  /** A lista ainda não chegou (carregando, erro ou Cofre bloqueado). */
  indisponivel: boolean;
  erro: string | null;
  /** Nome pelo cadastro; cai para o próprio código se não for achado. */
  rotulo: (codigo: string | null | undefined) => string;
  /** Recarrega ignorando o TTL. Chamar após criar, editar, desativar ou apagar. */
  recarregar: () => Promise<void>;
}

export function useFormasPagamento(): FormasPagamento {
  const snap = useSyncExternalStore(assinar, () => estado, () => estado);
  useEffect(() => { void carregar(false); }, []);
  const lista = useMemo(() => (snap.chave === chaveContextoCofre() ? snap.lista ?? [] : []), [snap]);
  const ativas = useMemo(() => lista.filter((f) => f.ativa), [lista]);
  const porCodigo = useMemo(() => new Map(lista.map((f) => [f.codigo, f])), [lista]);
  const rotulo = useCallback((codigo: string | null | undefined) => rotuloForma(lista, codigo), [lista]);
  const recarregar = useCallback(() => carregar(true), []);
  return { lista, ativas, porCodigo, carregando: snap.carregando && !snap.lista, indisponivel: !snap.lista, erro: snap.erro, rotulo, recarregar };
}
