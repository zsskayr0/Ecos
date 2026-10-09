import { useEffect } from "react";
import { tarefas as tarefasApi } from "@/lib/api";
import { dataLocalISO } from "@/lib/agenda-tempo";
import { lerPreferenciasAplicativo, type PreferenciasAplicativo } from "@/lib/preferencias-aplicativo";
import { avisar } from "@/lib/toast";

const CHAVE_ULTIMO = "ecos:resumo-diario:ultimo";

/** `HH:MM` → minutos desde 00:00; valor inválido vira `null`. */
export function minutosDoHorario(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Dentro do horário silencioso (que pode virar a meia-noite, como 22:00 → 07:00)? */
export function emSilencio(agora: Date, p: Pick<PreferenciasAplicativo, "silencioAtivo" | "silencioInicio" | "silencioFim">): boolean {
  if (!p.silencioAtivo) return false;
  const ini = minutosDoHorario(p.silencioInicio), fim = minutosDoHorario(p.silencioFim);
  if (ini === null || fim === null || ini === fim) return false;
  const m = agora.getHours() * 60 + agora.getMinutes();
  return ini < fim ? m >= ini && m < fim : m >= ini || m < fim;
}

/** O resumo do dia sai uma vez por dia, a partir da hora escolhida, fora do silêncio. */
export function deveEnviarResumo(agora: Date, p: PreferenciasAplicativo, ultimoEnvio: string | null): boolean {
  if (!p.resumoDiario || emSilencio(agora, p)) return false;
  const hora = minutosDoHorario(p.resumoHora);
  if (hora === null) return false;
  return agora.getHours() * 60 + agora.getMinutes() >= hora && ultimoEnvio !== dataLocalISO(agora);
}

interface TarefaParaResumo { status: "pendente" | "concluida"; scheduled_at: string | null; due_date: string | null }

/** Texto do resumo: o que vence hoje e o que já está atrasado. */
export function textoDoResumo(tarefas: TarefaParaResumo[], agora: Date): string {
  const hoje = dataLocalISO(agora);
  let doDia = 0, atrasadas = 0;
  for (const t of tarefas) {
    if (t.status !== "pendente") continue;
    const dia = t.scheduled_at ? dataLocalISO(new Date(t.scheduled_at)) : t.due_date ? t.due_date.slice(0, 10) : null;
    if (!dia) continue;
    if (dia === hoje) doDia++; else if (dia < hoje) atrasadas++;
  }
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  if (!doDia && !atrasadas) return "Nada marcado para hoje.";
  const partes = [];
  if (doDia) partes.push(`${plural(doDia, "tarefa para hoje", "tarefas para hoje")}`);
  if (atrasadas) partes.push(`${plural(atrasadas, "atrasada", "atrasadas")}`);
  return partes.join(" · ");
}

function notificarSistema(corpo: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Ecos — resumo do dia", { body: corpo });
  } catch { /* sem suporte a notificações do sistema */ }
}

/**
 * Confere a cada 30 s se é hora do resumo diário. Se o app abre depois da hora (e fora do silêncio), o resumo do
 * dia sai na hora, uma única vez. Só vale com o app aberto: o servidor ainda não envia notificações.
 */
export function useResumoDiario() {
  useEffect(() => {
    let vivo = true, rodando = false;
    async function conferir() {
      if (rodando) return;
      const agora = new Date();
      const prefs = lerPreferenciasAplicativo();
      let ultimo: string | null = null;
      try { ultimo = localStorage.getItem(CHAVE_ULTIMO); } catch { /* sem armazenamento */ }
      if (!deveEnviarResumo(agora, prefs, ultimo)) return;
      rodando = true;
      try {
        const { items } = await tarefasApi.listar({ limit: 200 });
        if (!vivo) return;
        const texto = textoDoResumo(items, agora);
        avisar(`Resumo do dia: ${texto}`);
        notificarSistema(texto);
        try { localStorage.setItem(CHAVE_ULTIMO, dataLocalISO(agora)); } catch { /* sem armazenamento */ }
      } catch { /* sem conexão ou sessão: tenta de novo no próximo ciclo */ }
      finally { rodando = false; }
    }
    void conferir();
    const id = window.setInterval(() => void conferir(), 30_000);
    return () => { vivo = false; window.clearInterval(id); };
  }, []);
}

/** Componente sem visual: liga o resumo diário enquanto o app está aberto. */
export function ResumoDiarioAgente() {
  useResumoDiario();
  return null;
}
