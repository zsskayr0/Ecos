/** Registro do "voltar/avançar" de cada aba (e do Cofre): cada MemoryRouter se registra aqui para que o botão do mouse, Alt+setas e a barra de abas comandem o histórico certo. */
export interface NavegacaoAba {
  ir: (delta: -1 | 1) => void;
  podeVoltar: () => boolean;
  podeAvancar: () => boolean;
}

const registro = new Map<string, NavegacaoAba>();
const ouvintes = new Set<() => void>();

export function registrarNavegacao(chave: string, nav: NavegacaoAba): () => void {
  registro.set(chave, nav);
  ouvintes.forEach((fn) => fn());
  return () => { if (registro.get(chave) === nav) registro.delete(chave); };
}

export function navegacaoDaAba(chave: string): NavegacaoAba | undefined {
  return registro.get(chave);
}

export function aoMudarNavegacao(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => { ouvintes.delete(fn); };
}

/** Quem estiver "no topo" (ex.: o Cofre, quando aberto) assume voltar/avançar; senão, a aba ativa do painel em foco. */
let chaveTopo: string | null = null;
export function definirTopoNavegacao(chave: string | null) { chaveTopo = chave; }
export function topoNavegacao() { return chaveTopo; }

export const LIMITE_HISTORICO = 50;
