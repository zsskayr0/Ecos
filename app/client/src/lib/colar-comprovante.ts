import { ehArquivoDoCofre } from "./tipos-comprovante";

const dois = (n: number) => String(n).padStart(2, "0");

const EXTENSAO_POR_TIPO: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" };

/** Imagem copiada de um app (WhatsApp, navegador, recorte de tela) chega sempre como `image.png`: ganha nome com data e hora. */
export function nomearColado(arquivo: File, agora: Date = new Date(), indice = 0, total = 1): File {
  if (arquivo.name && !/^image\.\w+$/i.test(arquivo.name)) return arquivo;
  const carimbo = `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}-${dois(agora.getHours())}${dois(agora.getMinutes())}${dois(agora.getSeconds())}`;
  const extensao = EXTENSAO_POR_TIPO[arquivo.type] ?? "png";
  return new File([arquivo], `colado-${carimbo}${total > 1 ? `-${indice + 1}` : ""}.${extensao}`, { type: arquivo.type });
}

/** É um campo onde a pessoa digita texto (colar texto ali é colar texto, não comprovante). */
function ehCampoDeTexto(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "button", "file", "range"].includes((el as HTMLInputElement).type));
}

/**
 * Arquivos do Ctrl+V que o Cofre aceita, ou `[]` quando o evento não é conosco: colar texto, ou colar dentro de um
 * campo de digitação junto com texto. Imagem copiada do WhatsApp Web não passa por disco: vem da área de transferência.
 */
export function arquivosColados(e: ClipboardEvent, agora: Date = new Date()): File[] {
  const dados = e.clipboardData;
  if (!dados) return [];
  const arquivos = Array.from(dados.files ?? []).filter(ehArquivoDoCofre);
  if (!arquivos.length) return [];
  const temTexto = Array.from(dados.types ?? []).includes("text/plain");
  if (temTexto && ehCampoDeTexto(e.target)) return [];
  return arquivos.map((a, i) => nomearColado(a, agora, i, arquivos.length));
}

export class AreaDeTransferenciaIndisponivel extends Error {}

/** Botão "Colar": lê a imagem da área de transferência. Precisa de permissão do navegador; se negada, o erro manda usar Ctrl+V. */
export async function lerAreaDeTransferencia(agora: Date = new Date()): Promise<File[]> {
  if (!navigator.clipboard?.read) throw new AreaDeTransferenciaIndisponivel("Este navegador não permite ler a área de transferência pelo botão. Use Ctrl+V.");
  let itens: ClipboardItems;
  try {
    itens = await navigator.clipboard.read();
  } catch {
    throw new AreaDeTransferenciaIndisponivel("Não consegui ler a área de transferência. Permita o acesso quando o app pedir, ou use Ctrl+V.");
  }
  const arquivos: File[] = [];
  for (const item of itens) {
    const tipo = item.types.find((t) => t.startsWith("image/") || t === "application/pdf");
    if (!tipo) continue;
    const blob = await item.getType(tipo);
    const arquivo = new File([blob], "image." + (EXTENSAO_POR_TIPO[tipo] ?? "png"), { type: tipo });
    if (ehArquivoDoCofre(arquivo)) arquivos.push(arquivo);
  }
  if (!arquivos.length) throw new AreaDeTransferenciaIndisponivel("Não há imagem na área de transferência. Copie a imagem do comprovante e tente de novo.");
  return arquivos.map((a, i) => nomearColado(a, agora, i, arquivos.length));
}
