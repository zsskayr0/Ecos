/**
 * Baixa em segundo plano, quando o navegador está ocioso, os pedaços das telas mais prováveis (Agenda, Tarefas, Notas),
 * para a primeira navegação não esperar a rede. Mesmos `import()` das rotas, então o Vite reaproveita os mesmos chunks.
 * Não roda offline, com economia de dados ou conexão 2g, e só uma vez por sessão.
 */
let feito = false;

export function prefetchRotasProvaveis(): void {
  // Em desenvolvimento o Vite serve cada módulo solto (HTTP/1.1, 6 conexões por origem): importar Agenda, Tarefas e Notas
  // aqui arrasta centenas de arquivos e a primeira tela que a pessoa abrir espera na fila atrás deles. No build de
  // produção são só três pedaços pequenos, então o prefetch fica lá.
  if (import.meta.env.DEV) return;
  if (feito || typeof navigator === "undefined") return;
  const conexao = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (navigator.onLine === false || conexao?.saveData || conexao?.effectiveType === "slow-2g" || conexao?.effectiveType === "2g") return;
  feito = true;
  const baixar = () => {
    void import("@/screens/Agenda/AgendaScreen").catch(() => undefined);
    void import("@/screens/Tasks/TaskFoldersRootScreen").catch(() => undefined);
    void import("@/screens/Notes/NotesRootScreen").catch(() => undefined);
  };
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === "function") ric(baixar, { timeout: 10_000 });
  else setTimeout(baixar, 4_000);
}
