import { useEffect, useRef } from "react";

/**
 * Arquivos recebidos pelo menu "Compartilhar" do Android (`CompartilharBridge.kt`, exposta ao WebView como
 * `window.EcosCompartilhar`). O menu tem dois destinos: "Ecos" (nota) e "Ecos Cofre" (comprovante). Fora do Android
 * a ponte não existe e tudo aqui vira no-op.
 */
interface PonteAndroid {
  pendentes(): string;
  parte(id: string, inicio: number, tamanho: number): string;
  descartar(id: string): void;
}

export type DestinoCompartilhado = "nota" | "cofre";

export interface Compartilhado {
  arquivo: File;
  destino: DestinoCompartilhado;
}

interface ItemPendente { id: string; nome: string; mime: string; tamanho: number; destino?: string }

/** Pedaço lido por chamada — bem abaixo do limite da ponte, sem passar a imagem inteira de uma vez. */
const PARTE_BYTES = 512 * 1024;

function ponte(): PonteAndroid | null {
  const p = (window as unknown as { EcosCompartilhar?: PonteAndroid }).EcosCompartilhar;
  return p && typeof p.pendentes === "function" ? p : null;
}

function bytesDeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let lendo = false;

/**
 * Pega (e apaga do lado nativo) os arquivos à espera. Só uma leitura por vez: quem chegar durante outra recebe `[]`.
 * A cópia nativa some assim que os bytes chegam aqui; quem precisar esperar (Cofre trancado) espera em memória.
 */
export async function lerCompartilhados(): Promise<Compartilhado[]> {
  const nativa = ponte();
  if (!nativa || lendo) return [];
  lendo = true;
  try {
    const itens = JSON.parse(nativa.pendentes() || "[]") as ItemPendente[];
    const lidos: Compartilhado[] = [];
    for (const item of itens) {
      try {
        const partes: BlobPart[] = [];
        for (let inicio = 0; inicio < item.tamanho; inicio += PARTE_BYTES) {
          const b64 = nativa.parte(item.id, inicio, PARTE_BYTES);
          if (!b64) throw new Error("leitura incompleta");
          partes.push(bytesDeBase64(b64));
        }
        // Versões antigas da ponte não informam o destino: eram só "Ecos" (nota).
        lidos.push({ arquivo: new File(partes, item.nome, { type: item.mime }), destino: item.destino === "cofre" ? "cofre" : "nota" });
      } catch {
        /* um arquivo que não deu pra ler não derruba os outros */
      } finally {
        nativa.descartar(item.id);
      }
    }
    return lidos;
  } catch {
    return [];
  } finally {
    lendo = false;
  }
}

/**
 * Chama `aoReceber` com o que foi compartilhado: o que já estava à espera quando o app abriu (compartilhar com o
 * app fechado) e o que chega depois (evento `ecos:compartilhado`, ou ao voltar pra frente).
 */
export function useCompartilhados(aoReceber: (itens: Compartilhado[]) => void) {
  const atual = useRef(aoReceber);
  atual.current = aoReceber;

  useEffect(() => {
    if (!ponte()) return;
    let ativo = true;
    async function verificar() {
      const itens = await lerCompartilhados();
      if (ativo && itens.length) atual.current(itens);
    }
    const aoVoltar = () => { if (document.visibilityState === "visible") void verificar(); };
    void verificar();
    window.addEventListener("ecos:compartilhado", verificar);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      ativo = false;
      window.removeEventListener("ecos:compartilhado", verificar);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);
}
