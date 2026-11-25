import { useEffect, useRef } from "react";
import type { Janela } from "@/lib/timeline";

/**
 * Memória da Timeline entre idas e voltas: ao abrir uma nota ou tarefa e voltar, a tela é montada de novo — sem
 * isto, voltaria para hoje, com a janela inicial e os grupos fechados de novo. Fica só em memória (some ao recarregar
 * o app) e só vale no mesmo dia.
 */
export interface MemoriaTimeline {
  dia: string;
  janela: Janela;
  recolhidos: string[];
  mesCalendario: string;
  rolagem: number;
}

let memoria: MemoriaTimeline | null = null;

/** O que foi guardado na última visita de hoje, se houver. */
export function lerMemoria(hoje: string): MemoriaTimeline | null {
  return memoria && memoria.dia === hoje ? memoria : null;
}

/** Guarda o estado a cada mudança e a rolagem enquanto a pessoa rola (no desmonte a página já pode ter trocado). */
export function useGuardarMemoria(estado: Omit<MemoriaTimeline, "rolagem">) {
  const rolagem = useRef(memoria?.dia === estado.dia ? memoria.rolagem : 0);
  useEffect(() => {
    const aoRolar = () => { rolagem.current = window.scrollY; };
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);
  const { dia, janela, recolhidos, mesCalendario } = estado;
  useEffect(() => {
    memoria = { dia, janela, recolhidos, mesCalendario, rolagem: rolagem.current };
  });
  useEffect(() => () => { if (memoria) memoria.rolagem = rolagem.current; }, []);
}
