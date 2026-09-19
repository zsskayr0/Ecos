import { useCallback, useEffect, useState } from "react";
import { avatarPerfil } from "./api";

const EVENTO_ATUALIZADO = "ecos:avatar-atualizado";
const chaveLegada = (id: string) => `ecos:avatar:${id}`;
const TAMANHO_MAXIMO = 2 * 1024 * 1024;
const fotosEmMemoria = new Map<string, string | undefined>();
const versoesEmMemoria = new Map<string, number | null | undefined>();
const carregamentos = new Map<string, Promise<string | undefined>>();

function fotoLegada(id?: string) {
  if (!id) return undefined;
  try { return localStorage.getItem(chaveLegada(id)) ?? undefined; } catch { return undefined; }
}

export function limparFotoLegada(id: string) {
  try { localStorage.removeItem(chaveLegada(id)); } catch { /* armazenamento indisponível */ }
}

export function notificarFotoPerfilAtualizada(id: string) {
  window.dispatchEvent(new CustomEvent(EVENTO_ATUALIZADO, { detail: id }));
}

async function carregarFoto(id: string, versao?: number | null, forcar = false): Promise<string | undefined> {
  if (!forcar && fotosEmMemoria.has(id) && versoesEmMemoria.get(id) === versao) return fotosEmMemoria.get(id);
  const existente = carregamentos.get(id);
  if (existente) return existente;
  const carregamento = avatarPerfil.obter().then((blob) => {
    const anterior = fotosEmMemoria.get(id);
    const proxima = blob ? URL.createObjectURL(blob) : fotoLegada(id);
    if (anterior?.startsWith("blob:") && anterior !== proxima) URL.revokeObjectURL(anterior);
    fotosEmMemoria.set(id, proxima);
    versoesEmMemoria.set(id, versao);
    return proxima;
  }).finally(() => carregamentos.delete(id));
  carregamentos.set(id, carregamento);
  return carregamento;
}

const canvasParaBlob = (canvas: HTMLCanvasElement, tipo: string, qualidade: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, tipo, qualidade));

/** Fotos de câmera costumam passar facilmente de 2 MB. Reduz a dimensão e
 * comprime localmente antes do upload, sem exigir uma etapa manual. */
export async function prepararFotoPerfil(arquivo: File): Promise<File> {
  if (!arquivo.type.startsWith("image/")) throw new Error("Escolha uma imagem.");
  if (arquivo.size <= TAMANHO_MAXIMO && ["image/png", "image/jpeg", "image/webp"].includes(arquivo.type)) return arquivo;

  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(arquivo); }
  catch { throw new Error("Não foi possível processar essa imagem. Use PNG, JPEG ou WebP."); }

  try {
    const limite = 1280;
    const escala = Math.min(1, limite / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const contexto = canvas.getContext("2d", { alpha: true });
    if (!contexto) throw new Error("Não foi possível preparar a imagem.");
    contexto.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    for (const qualidade of [0.9, 0.82, 0.72, 0.62]) {
      const blob = await canvasParaBlob(canvas, "image/webp", qualidade);
      if (blob && blob.size <= TAMANHO_MAXIMO) return new File([blob], "foto-perfil.webp", { type: "image/webp" });
    }
    const blob = await canvasParaBlob(canvas, "image/jpeg", 0.72);
    if (blob && blob.size <= TAMANHO_MAXIMO) return new File([blob], "foto-perfil.jpg", { type: "image/jpeg" });
    throw new Error("Não foi possível reduzir a imagem para o tamanho aceito.");
  } finally { bitmap.close(); }
}

/** Carrega a foto autenticada como Blob. Isso também funciona no Tauri,
 * onde uma tag `<img>` não consegue acrescentar o Bearer token sozinha. */
export function useFotoPerfil(id?: string, versao?: number | null) {
  const [url, setUrl] = useState<string | undefined>(() => id ? fotosEmMemoria.get(id) ?? fotoLegada(id) : undefined);

  const recarregar = useCallback(async (forcar = false) => {
    if (!id) { setUrl(undefined); return; }
    try {
      setUrl(await carregarFoto(id, versao, forcar));
    } catch {
      setUrl((atual) => atual ?? fotosEmMemoria.get(id) ?? fotoLegada(id));
    }
  }, [id, versao]);

  useEffect(() => {
    setUrl(id ? fotosEmMemoria.get(id) ?? fotoLegada(id) : undefined);
    void recarregar();
  }, [id, recarregar, versao]);
  useEffect(() => {
    const atualizar = (evento: Event) => { if ((evento as CustomEvent<string>).detail === id) void recarregar(true); };
    window.addEventListener(EVENTO_ATUALIZADO, atualizar);
    return () => window.removeEventListener(EVENTO_ATUALIZADO, atualizar);
  }, [id, recarregar]);

  return { url, recarregar };
}
