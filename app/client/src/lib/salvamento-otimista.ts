import { useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import type { NotaNoServidor } from "./nota-sincronia";

/**
 * Princípio otimista entre o front e o servidor: a tela aceita tudo o que a pessoa faz, na hora, e o servidor acompanha
 * por trás. Nada aqui bloqueia a digitação; o que o servidor recusar volta como aviso, nunca como texto perdido.
 * Regras puras (sem React) ficam neste arquivo para os editores e as capturas usarem e os testes cobrirem.
 */

/** Falha que passa sozinha (limite de pedidos, servidor ocupado, resposta estranha): vale tentar de novo sem incomodar. */
export function ehFalhaTransitoria(erro: unknown): boolean {
  if (!(erro instanceof ApiError)) return true;
  if (erro.code === "CONEXAO_INDISPONIVEL" || erro.code === "RESPOSTA_INESPERADA") return true;
  return erro.status === 0 || erro.status === 408 || erro.status === 425 || erro.status === 429 || erro.status >= 500;
}

const ESPERAS_REENVIO_MS = [2_000, 5_000, 15_000, 30_000];

/** Quanto esperar antes da tentativa `n` (0 = a primeira nova tentativa): 2 s, 5 s, 15 s e depois a cada 30 s. */
export function esperaDoReenvio(tentativa: number): number {
  return ESPERAS_REENVIO_MS[Math.min(Math.max(0, tentativa), ESPERAS_REENVIO_MS.length - 1)];
}

/**
 * Enquanto `ativo` (há uma falha passageira pendente), chama `reenviar` com espera crescente até dar certo. Quando a falha
 * some (`ativo` volta a false) a contagem recomeça. Ninguém precisa digitar de novo para o salvamento insistir.
 */
export function useReenvioAutomatico(ativo: boolean, reenviar: () => void): void {
  const ultimo = useRef(reenviar);
  ultimo.current = reenviar;
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    if (!ativo) { if (tentativa !== 0) setTentativa(0); return; }
    const timer = window.setTimeout(() => { setTentativa((t) => t + 1); ultimo.current(); }, esperaDoReenvio(tentativa));
    return () => window.clearTimeout(timer);
  }, [ativo, tentativa]);
}

/**
 * 409 que não é conflito de verdade: o servidor só subiu a versão (fila offline que foi enviada depois, nota arquivada ou
 * revisada em outro lugar), mas o texto dele é o da última base confirmada ou já é o que a pessoa tem. Nesses casos
 * basta adotar a versão nova e salvar de novo, sem perguntar nada.
 */
export function conflitoFalso(servidor: NotaNoServidor, base: { titulo: string; corpo: string }, atual: { titulo: string; corpo: string }): boolean {
  const igual = (o: { titulo: string; corpo: string }) => servidor.corpo === o.corpo && (servidor.titulo === o.titulo || !o.titulo.trim());
  return igual(base) || igual(atual);
}

/** Limite do título tirado da primeira linha da captura. Acima disso o texto inteiro vai para o corpo. */
export const TITULO_CAPTURA_MAX = 200;

/** Título a partir de um corpo (mesma regra do servidor): primeira linha com texto, sem marcadores de Markdown. */
export function tituloDoCorpo(corpo: string): string {
  const linha = corpo.split("\n").map((l) => l.trim()).find((l) => l && !/^[-*_`=#]+$/.test(l));
  if (!linha) return "";
  const limpa = linha.replace(/^[#>\-*+ ]+/, "").replace(/^\[[ xX]\]\s*/, "").trim() || linha;
  return cortarEmPalavra(limpa, 120);
}

/** O título que a pessoa escreveu ou, em branco, o do começo do corpo. Só para criar; editar nunca manda título em branco. */
export function tituloParaCriar(titulo: string, corpo: string): string {
  return titulo.trim() ? titulo : tituloDoCorpo(corpo);
}

function cortarEmPalavra(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  const corte = texto.slice(0, limite);
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > limite / 2 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}

/**
 * Captura rápida: a primeira linha é o título inteiro (nada de cortar no meio da palavra) e o resto é o corpo. Só uma
 * primeira linha realmente enorme vira título cortado em palavra inteira, e aí o texto completo fica no corpo.
 */
export function separarCaptura(texto: string): { titulo: string; corpo: string } {
  const limpo = texto.trim();
  const [primeira, ...resto] = limpo.split("\n");
  const linha = primeira.trim();
  if (linha.length <= TITULO_CAPTURA_MAX) return { titulo: linha, corpo: resto.join("\n").trim() };
  return { titulo: cortarEmPalavra(linha, TITULO_CAPTURA_MAX), corpo: limpo };
}

/** Só manda título que existe: apagar o campo para reescrever não pode renomear a nota para "" nem travar o resto. */
export function tituloParaEnviar(titulo: string): { titulo: string } | Record<string, never> {
  return titulo.trim() ? { titulo } : {};
}

/** Para saber se há o que enviar: título em branco é ignorado (o servidor manteria o atual). */
export function tituloEfetivo(titulo: string, base: string): string {
  return titulo.trim() ? titulo : base;
}
