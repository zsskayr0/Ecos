import { useEffect, useState } from "react";

export type Tema = "dark" | "light";
/** O que a pessoa escolheu: um tema fixo ou acompanhar o sistema operacional. */
export type ModoTema = Tema | "sistema" | "horario";
const CHAVE = "ecos-tema";
const CHAVE_HORARIO = "ecos-tema-horario";

/** Janela do tema claro no modo "horario": de `claro` até `escuro` (HH:MM, horário local). */
export type HorarioTema = { claro: string; escuro: string };
const HORARIO_PADRAO: HorarioTema = { claro: "07:00", escuro: "19:00" };
const valido = (h: unknown): h is string => typeof h === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(h);

export function horarioTemaSalvo(): HorarioTema {
  try {
    const h = JSON.parse(localStorage.getItem(CHAVE_HORARIO) ?? "null");
    if (h && valido(h.claro) && valido(h.escuro)) return { claro: h.claro, escuro: h.escuro };
  } catch { /* usa o padrão */ }
  return { ...HORARIO_PADRAO };
}

export function salvarHorarioTema(h: HorarioTema) {
  try { localStorage.setItem(CHAVE_HORARIO, JSON.stringify(h)); } catch { /* só memória */ }
  window.dispatchEvent(new Event("ecos-tema-horario"));
}

const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/** Tema pelo relógio local. Aceita janela que atravessa a meia-noite (claro 20:00, escuro 06:00). */
export function temaPorHorario(h: HorarioTema, agora = new Date()): Tema {
  const m = agora.getHours() * 60 + agora.getMinutes(), c = minutos(h.claro), e = minutos(h.escuro);
  if (c === e) return "light";
  const claro = c < e ? m >= c && m < e : m >= c || m < e;
  return claro ? "light" : "dark";
}

/** Milissegundos até a próxima troca no modo "horario" (+1 s de folga). */
function msAteProximaTroca(h: HorarioTema, agora = new Date()): number {
  const m = agora.getHours() * 60 + agora.getMinutes();
  const faltam = [minutos(h.claro), minutos(h.escuro)].map((alvo) => ((alvo - m + 1440) % 1440) || 1440);
  return Math.min(...faltam) * 60_000 - agora.getSeconds() * 1000 - agora.getMilliseconds() + 1000;
}

export function modoTemaSalvo(): ModoTema {
  try {
    const salvo = localStorage.getItem(CHAVE);
    // Sem preferência salva (primeira abertura), o app acompanha o sistema.
    return salvo === "light" || salvo === "dark" || salvo === "sistema" || salvo === "horario" ? salvo : "sistema";
  } catch { return "sistema"; }
}

const sistemaPrefereClaro = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: light)").matches;

/** Resolve o modo no tema que de fato se aplica agora. */
export function resolverTema(modo: ModoTema): Tema {
  if (modo === "horario") return temaPorHorario(horarioTemaSalvo());
  return modo === "sistema" ? (sistemaPrefereClaro() ? "light" : "dark") : modo;
}

export function temaInicial(): Tema { return resolverTema(modoTemaSalvo()); }

/** Aplica a preferência antes da primeira renderização, evitando um flash escuro no modo claro. */
export function aplicarTemaInicial() {
  if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", temaInicial());
}

/** Chamado uma vez na partida: com "sistema" escolhido, o tema acompanha o sistema em qualquer tela. */
export function acompanharTemaDoSistema() {
  if (typeof window === "undefined") return;
  // Modo "horario": reavalia a cada minuto e ao voltar para o app (o timer pode dormir em segundo plano).
  const reavaliarHorario = () => { if (modoTemaSalvo() === "horario") document.documentElement.setAttribute("data-theme", resolverTema("horario")); };
  window.setInterval(reavaliarHorario, 60_000);
  document.addEventListener("visibilitychange", reavaliarHorario);
  if (!window.matchMedia) return;
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (modoTemaSalvo() === "sistema") document.documentElement.setAttribute("data-theme", resolverTema("sistema"));
  });
}

/** Sem escolha salva o tema acompanha o sistema; quem escolhe Escuro ou Claro fica com o que escolheu. */
export function useTema() {
  const [modo, setModo] = useState<ModoTema>(modoTemaSalvo);
  const [tema, setTema] = useState<Tema>(() => resolverTema(modoTemaSalvo()));

  useEffect(() => {
    setTema(resolverTema(modo));
    try {
      localStorage.setItem(CHAVE, modo);
    } catch {
      /* localStorage unavailable — falls back to memory only. */
    }
    if (modo === "horario") {
      let timer = 0;
      const agendar = () => { setTema(resolverTema("horario")); window.clearTimeout(timer); timer = window.setTimeout(agendar, msAteProximaTroca(horarioTemaSalvo())); };
      agendar();
      window.addEventListener("ecos-tema-horario", agendar);
      document.addEventListener("visibilitychange", agendar);
      return () => { window.clearTimeout(timer); window.removeEventListener("ecos-tema-horario", agendar); document.removeEventListener("visibilitychange", agendar); };
    }
    if (modo !== "sistema" || !window.matchMedia) return;
    // No modo "sistema" o tema acompanha o sistema ao vivo (ex.: o aparelho muda para escuro ao anoitecer).
    const consulta = window.matchMedia("(prefers-color-scheme: light)");
    const aoMudar = () => setTema(resolverTema("sistema"));
    consulta.addEventListener("change", aoMudar);
    return () => consulta.removeEventListener("change", aoMudar);
  }, [modo]);

  useEffect(() => { document.documentElement.setAttribute("data-theme", tema); }, [tema]);

  return { tema, modo, setTema: setModo };
}
