import { preferenciasAplicativoApi } from "./api";
import { CHAVE_PREFERENCIAS_APLICATIVO, PADRAO_PREFERENCIAS_APLICATIVO, lerPreferenciasAplicativo, salvarPreferenciasAplicativo, type PreferenciasAplicativo } from "./preferencias-aplicativo";

/**
 * Preferências do aplicativo por conta: o servidor guarda o documento e cada aparelho espelha uma cópia no
 * `localStorage` (que continua sendo o que o app lê, então tudo funciona offline). Ao entrar sobe o que o aparelho já
 * tinha se a conta nunca salvou; depois cada mudança vai ao servidor (com atraso curto) e os outros aparelhos a puxam
 * ao voltar o foco e de tempos em tempos. Vale a última gravação.
 */
const CHAVE_DONO = "ecos:preferencias-aplicativo:usuario";
/** Só fazem sentido no aparelho em que foram escolhidas: ficam fora do que sincroniza. */
export const CHAVES_SO_DO_APARELHO = ["aceleracaoHardware", "escalaInterface"] as const satisfies readonly (keyof PreferenciasAplicativo)[];
const ATRASO_ENVIO_MS = 800;
const INTERVALO_PUXAR_MS = 5 * 60_000;

let aplicandoDoServidor = false;
let pendente = false;
let temporizador: number | undefined;

function paraOServidor(p: PreferenciasAplicativo): Record<string, unknown> {
  const doc: Record<string, unknown> = { ...p };
  for (const c of CHAVES_SO_DO_APARELHO) delete doc[c];
  return doc;
}

function guardarDono(usuarioId: string) {
  try { localStorage.setItem(CHAVE_DONO, usuarioId); } catch { /* sem armazenamento */ }
}

function aplicarDoServidor(dados: Record<string, unknown>) {
  const local = lerPreferenciasAplicativo();
  const conhecidas = Object.fromEntries(Object.entries(dados).filter(([k]) => k in PADRAO_PREFERENCIAS_APLICATIVO && !(CHAVES_SO_DO_APARELHO as readonly string[]).includes(k)));
  const nova = { ...PADRAO_PREFERENCIAS_APLICATIVO, ...conhecidas } as PreferenciasAplicativo;
  for (const c of CHAVES_SO_DO_APARELHO) (nova as unknown as Record<string, unknown>)[c] = local[c];
  if (JSON.stringify(paraOServidor(nova)) === JSON.stringify(paraOServidor(local))) return;
  aplicandoDoServidor = true;
  try { salvarPreferenciasAplicativo(nova); } finally { aplicandoDoServidor = false; }
}

async function enviar() {
  pendente = false;
  try { await preferenciasAplicativoApi.salvar(paraOServidor(lerPreferenciasAplicativo())); } catch { pendente = true; /* sem rede: tenta de novo na próxima mudança ou volta */ }
}

/** Puxa do servidor; se a conta nunca salvou e a cópia local é desta conta (ou sem dono), sobe a local. */
async function sincronizar(usuarioId: string) {
  if (pendente) { await enviar(); return; }
  try {
    const remoto = await preferenciasAplicativoApi.obter();
    if (remoto.definido) { aplicarDoServidor(remoto.dados); guardarDono(usuarioId); return; }
    let dono: string | null = null;
    let temLocal = false;
    try { dono = localStorage.getItem(CHAVE_DONO); temLocal = localStorage.getItem(CHAVE_PREFERENCIAS_APLICATIVO) !== null; } catch { /* sem armazenamento */ }
    if (temLocal && (dono === null || dono === usuarioId)) { await enviar(); guardarDono(usuarioId); return; }
    // Cópia de outra conta (ou nada salvo): esta conta começa com os padrões.
    aplicarDoServidor({});
    guardarDono(usuarioId);
  } catch { /* offline: a cópia local continua valendo */ }
}

/** Liga a sincronia para a conta logada; devolve a função que desliga (troca de conta ou sair). */
export function iniciarSincroniaPreferenciasAplicativo(usuarioId: string): () => void {
  void sincronizar(usuarioId);
  const aoSalvar = () => {
    if (aplicandoDoServidor) return;
    pendente = true;
    window.clearTimeout(temporizador);
    temporizador = window.setTimeout(() => { void enviar().then(() => guardarDono(usuarioId)); }, ATRASO_ENVIO_MS);
  };
  const aoVoltar = () => { if (document.visibilityState === "visible") void sincronizar(usuarioId); };
  const relogio = window.setInterval(aoVoltar, INTERVALO_PUXAR_MS);
  window.addEventListener("ecos:preferencias-aplicativo", aoSalvar);
  document.addEventListener("visibilitychange", aoVoltar);
  window.addEventListener("online", aoVoltar);
  return () => {
    window.clearTimeout(temporizador);
    window.clearInterval(relogio);
    window.removeEventListener("ecos:preferencias-aplicativo", aoSalvar);
    document.removeEventListener("visibilitychange", aoVoltar);
    window.removeEventListener("online", aoVoltar);
  };
}
