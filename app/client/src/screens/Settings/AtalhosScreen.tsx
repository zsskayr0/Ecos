import { Keyboard } from "lucide-react";
import { Cabecalho, ancoraDe } from "./campos-config";

const ehMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const MOD = ehMac ? "⌘" : "Ctrl";

/** Atalhos que existem hoje (só desktop). A lista é de consulta: ainda não dá para remapear. */
export const GRUPOS_ATALHOS: { titulo: string; atalhos: { teclas: string[]; acao: string }[] }[] = [
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
  ] },
  { titulo: "Captura rápida", atalhos: [
    { teclas: ["Enter"], acao: "Criar (nota ou tarefa, conforme Editor e escrita › Enter cria)" },
    { teclas: [MOD, "Enter"], acao: "Criar o outro tipo" },
    { teclas: ["Shift", "Enter"], acao: "Quebrar a linha" },
  ] },
];

export function AtalhosScreen() {
  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Atalhos de teclado" />
      <p className="mb-5 flex items-center gap-2 text-sm text-text-muted"><Keyboard size={16} />Lista de consulta. Ainda não é possível remapear.</p>
      {GRUPOS_ATALHOS.map(({ titulo, atalhos }) => (
        <section key={titulo} className="mt-6 first:mt-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{titulo}</p>
          <div className="rounded-2xl border border-border bg-surface-1 p-2">
            {atalhos.map(({ teclas, acao }) => (
              <div key={acao} data-config={ancoraDe(acao)} className="flex min-h-11 items-center justify-between gap-4 rounded-lg px-3 py-2 hover:bg-surface-2">
                <span className="text-sm text-text-secondary">{acao}</span>
                <span className="flex shrink-0 items-center gap-1">{teclas.map((t) => <kbd key={t} className="rounded border border-border bg-surface-3 px-1.5 py-0.5 font-mono-value text-[11px] text-text-primary">{t}</kbd>)}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
