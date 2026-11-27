/**
 * Lista única dos atalhos de teclado do Ecos (desktop). Alimenta Configurações › Atalhos de teclado, a Central de
 * ajuda e a paleta de comandos. Registrou um atalho novo no código? Acrescente aqui, no grupo de onde ele vale.
 */
export interface Atalho { teclas: string[]; acao: string }
export interface GrupoAtalhos { titulo: string; /** Onde o atalho vale, quando não é no app inteiro. */ onde?: string; atalhos: Atalho[] }

const ehMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
export const MOD = ehMac ? "⌘" : "Ctrl";

/** Atalhos da tela Categorias do Cofre (o componente de ajuda de lá lê daqui). */
export const ATALHOS_CATEGORIAS_COFRE: { teclas: string; acao: string }[] = [
  { teclas: "/", acao: "Buscar categoria" },
  { teclas: "N", acao: "Nova categoria" },
  { teclas: "1 – 6", acao: "Grade, Lista, Tabela, Kanban, Mapa e Nuvem" },
  { teclas: "S", acao: "Mostrar ou esconder subcategorias" },
  { teclas: "A", acao: "Mostrar ou esconder arquivadas" },
  { teclas: "D", acao: "Revisar categorias parecidas" },
  { teclas: "I", acao: "Modelos, importar e exportar" },
  { teclas: "Ctrl + A", acao: "Selecionar tudo que está visível" },
  { teclas: "Esc", acao: "Fechar painel ou limpar a seleção" },
  { teclas: "?", acao: "Mostrar esta ajuda" },
];

export const GRUPOS_ATALHOS: GrupoAtalhos[] = [
  { titulo: "Navegação", atalhos: [
    { teclas: [MOD, "K"], acao: "Abrir a paleta de comandos" },
    { teclas: [MOD, "Shift", "K"], acao: "Paleta de comandos global (busca em tudo)" },
    { teclas: [MOD, "B"], acao: "Recolher ou expandir a barra lateral" },
    { teclas: ["Alt", "← →"], acao: "Voltar e avançar no histórico" },
  ] },
  { titulo: "Abas e painéis", atalhos: [
    { teclas: [MOD, "W"], acao: "Fechar a aba atual" },
    { teclas: [MOD, "Tab"], acao: "Ir para a próxima aba (com Shift, a anterior)" },
    { teclas: [MOD, "\\"], acao: "Dividir o painel para a direita" },
    { teclas: [MOD, "1–9"], acao: "Focar o painel pelo número" },
    { teclas: ["Delete"], acao: "Fechar a aba com foco" },
    { teclas: ["Alt", "← →"], acao: "Mover a aba com foco para o lado (também Ctrl+Shift+← →)" },
    { teclas: ["Shift", "F10"], acao: "Menu da aba com foco" },
  ] },
  { titulo: "Editor de texto", atalhos: [
    { teclas: ["Tab"], acao: "No título, ir direto para o texto" },
    { teclas: [MOD, "B"], acao: "Negrito (sem seleção, a palavra sob o cursor)" },
    { teclas: [MOD, "I"], acao: "Itálico" },
    { teclas: [MOD, "Shift", "X"], acao: "Tachado" },
    { teclas: [MOD, "E"], acao: "Código" },
    { teclas: [MOD, "K"], acao: "Link (dentro do editor; fora dele, a paleta)" },
    { teclas: [MOD, "Alt", "1–3"], acao: "Título 1, 2 ou 3 (Alt+0 volta ao normal)" },
    { teclas: [MOD, "Shift", "7"], acao: "Lista numerada" },
    { teclas: [MOD, "Shift", "8"], acao: "Lista com marcadores" },
    { teclas: [MOD, "Shift", "9"], acao: "Checklist" },
    { teclas: ["Enter"], acao: "Continuar a lista (numa linha vazia, encerra)" },
    { teclas: ["Tab"], acao: "Indentar (Shift+Tab recua; Esc e depois Tab sai do editor)" },
    { teclas: ["Alt", "↑ ↓"], acao: "Mover a linha" },
    { teclas: [MOD, "F"], acao: "Buscar no texto (F3 vai para a próxima)" },
    { teclas: [MOD, "H"], acao: "Buscar e substituir" },
    { teclas: [MOD, "/"], acao: "Mostrar os atalhos do editor (ou ? fora do texto)" },
  ] },
  { titulo: "Captura rápida", atalhos: [
    { teclas: ["Enter"], acao: "Criar (nota ou tarefa, conforme Editor e escrita › Enter cria)" },
    { teclas: [MOD, "Enter"], acao: "Criar o outro tipo" },
    { teclas: ["Shift", "Enter"], acao: "Quebrar a linha" },
  ] },
  { titulo: "Explorador e Arquivos", onde: "Na árvore lateral e na tela Arquivos", atalhos: [
    { teclas: [MOD, "A"], acao: "Selecionar tudo" },
    { teclas: ["F2"], acao: "Renomear o item selecionado" },
    { teclas: ["Delete"], acao: "Mandar a seleção para a Lixeira" },
    { teclas: ["Backspace"], acao: "Subir uma pasta (tela Arquivos)" },
    { teclas: ["Esc"], acao: "Limpar a seleção" },
  ] },
  { titulo: "Agenda", onde: "Com um bloco da grade em foco", atalhos: [
    { teclas: ["M"], acao: "Abrir o menu do bloco (também Shift+F10)" },
    { teclas: ["Delete"], acao: "Remover o bloco" },
  ] },
  { titulo: "Cofre", onde: "Lançamentos e Cadastros", atalhos: [
    { teclas: [MOD, "A"], acao: "Selecionar todos os lançamentos da lista" },
    { teclas: ["Esc"], acao: "Sair da seleção" },
    { teclas: ["N"], acao: "Novo cadastro (Cadastros)" },
    { teclas: ["/"], acao: "Buscar cadastro (Cadastros)" },
  ] },
  { titulo: "Cofre › Categorias", onde: "Tela Categorias do Cofre", atalhos: ATALHOS_CATEGORIAS_COFRE.map((a) => ({
    teclas: a.teclas.split(/\s*\+\s*/).map((t) => (t === "Ctrl" ? MOD : t)),
    acao: a.acao,
  })) },
];

/** Todos os atalhos com o grupo, para busca (paleta de comandos). */
export function todosOsAtalhos(): (Atalho & { grupo: string })[] {
  return GRUPOS_ATALHOS.flatMap((g) => g.atalhos.map((a) => ({ ...a, grupo: g.titulo })));
}

export const teclasComoTexto = (teclas: string[]) => teclas.join(" + ");
