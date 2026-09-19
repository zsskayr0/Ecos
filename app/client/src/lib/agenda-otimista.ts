import { useCallback, useEffect, useRef } from "react";

/**
 * Edição otimista com rollback: a tela muda na hora e o servidor é avisado depois. Se ele recusar, o item volta para
 * o último estado que o servidor CONFIRMOU (não para o que estava na tela um instante atrás).
 *
 *  - Várias edições seguidas no mesmo item (setas do teclado) viram um único `PATCH`, com os campos acumulados.
 *  - Um item nunca tem dois envios em voo: a edição que chega durante um envio espera o anterior terminar.
 *  - Se um envio falha, o que ainda estava na fila daquele item é descartado junto com o rollback — foi calculado em
 *    cima de um estado que o servidor não aceitou.
 *  - Ao desmontar, o que ainda não foi enviado é enviado (uma edição feita não se perde por trocar de tela).
 */
interface Opcoes<T extends { id: string }, P extends object> {
  itens: T[];
  setItens: (atualizar: (atuais: T[]) => T[]) => void;
  salvar: (id: string, payload: P) => Promise<unknown>;
  aplicar: (item: T, payload: P) => T;
  aoConfirmar?: () => void;
  aoFalhar?: (erro: unknown, id: string) => void;
  /** Espera antes de enviar, para juntar edições em rajada. */
  atrasoMs?: number;
}

interface Entrada<T, P> {
  confirmado: T;
  acumulado: P;
  enviando: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export function useEdicaoOtimista<T extends { id: string }, P extends object>(opcoes: Opcoes<T, P>) {
  const atual = useRef(opcoes);
  atual.current = opcoes;
  const entradas = useRef(new Map<string, Entrada<T, P>>());

  const descarregar = useCallback((id: string) => {
    const entrada = entradas.current.get(id);
    if (!entrada || entrada.enviando) return;
    if (entrada.timer) clearTimeout(entrada.timer);
    entrada.timer = null;
    if (!Object.keys(entrada.acumulado).length) {
      entradas.current.delete(id);
      return;
    }
    const enviado = entrada.acumulado;
    entrada.acumulado = {} as P;
    entrada.enviando = true;
    atual.current.salvar(id, enviado).then(
      () => {
        entrada.confirmado = atual.current.aplicar(entrada.confirmado, enviado);
        entrada.enviando = false;
        if (Object.keys(entrada.acumulado).length) {
          descarregar(id);
        } else {
          entradas.current.delete(id);
          atual.current.aoConfirmar?.();
        }
      },
      (erro) => {
        atual.current.setItens((itens) => itens.map((item) => (item.id === id ? entrada.confirmado : item)));
        entradas.current.delete(id);
        atual.current.aoFalhar?.(erro, id);
      },
    );
  }, []);

  const editar = useCallback(
    (id: string, payload: P, { imediato = true }: { imediato?: boolean } = {}) => {
      const { itens, setItens, aplicar, atrasoMs = 350 } = atual.current;
      let entrada = entradas.current.get(id);
      if (!entrada) {
        const item = itens.find((i) => i.id === id);
        if (!item) return;
        entrada = { confirmado: item, acumulado: {} as P, enviando: false, timer: null };
        entradas.current.set(id, entrada);
      }
      entrada.acumulado = { ...entrada.acumulado, ...payload };
      setItens((lista) => lista.map((item) => (item.id === id ? aplicar(item, payload) : item)));
      if (entrada.timer) clearTimeout(entrada.timer);
      entrada.timer = null;
      if (imediato) descarregar(id);
      else entrada.timer = setTimeout(() => descarregar(id), atrasoMs);
    },
    [descarregar],
  );

  useEffect(
    () => () => {
      for (const id of [...entradas.current.keys()]) descarregar(id);
    },
    [descarregar],
  );

  return { editar };
}
