import { ANEXO_TAMANHO_MAXIMO_BYTES } from "./tipos-comprovante";

/** Sobra de segurança sob o limite do Cofre (o envelope multipart também conta). */
const ALVO_BYTES = Math.floor(ANEXO_TAMANHO_MAXIMO_BYTES * 0.92);
const LADO_MAXIMO = 3000;
const QUALIDADES = [0.88, 0.8, 0.7, 0.6];

export class ComprovanteGrandeDemais extends Error {
  constructor(nome: string, motivo: string) {
    super(`“${nome}” passa de 8 MB. ${motivo}`);
  }
}

/** Dependências do navegador, trocáveis nos testes (jsdom não tem canvas). */
export interface Reducao {
  /** Reencoda a imagem em JPEG, com no máximo `lado` px no maior lado e a `qualidade`; `null` se o navegador não conseguiu abrir. */
  reencodar(arquivo: File, lado: number, qualidade: number): Promise<Blob | null>;
}

const navegador: Reducao = {
  async reencodar(arquivo, lado, qualidade) {
    try {
      const bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
      const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
      const largura = Math.max(1, Math.round(bitmap.width * escala));
      const altura = Math.max(1, Math.round(bitmap.height * escala));
      const tela = document.createElement("canvas");
      tela.width = largura;
      tela.height = altura;
      const ctx = tela.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#fff"; // PNG com transparência vira fundo branco, não preto
      ctx.fillRect(0, 0, largura, altura);
      ctx.drawImage(bitmap, 0, 0, largura, altura);
      bitmap.close();
      return await new Promise<Blob | null>((ok) => tela.toBlob(ok, "image/jpeg", qualidade));
    } catch {
      return null;
    }
  },
};

/**
 * Deixa o arquivo dentro do limite do Cofre. Dentro do limite, passa intacto (o comprovante original não é alterado).
 * Foto acima do limite é reduzida (JPEG, até 3.000 px) em vez de recusada: fotos de celular passam fácil de 8 MB.
 * PDF e HEIC não dá para reduzir aqui — nesses casos o erro explica o que fazer.
 */
export async function prepararComprovante(arquivo: File, reducao: Reducao = navegador): Promise<File> {
  if (arquivo.size <= ANEXO_TAMANHO_MAXIMO_BYTES) return arquivo;
  if (arquivo.type === "application/pdf") throw new ComprovanteGrandeDemais(arquivo.name, "Reduza o PDF (por exemplo, exporte de novo em qualidade menor) e tente de novo.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(arquivo.type)) {
    throw new ComprovanteGrandeDemais(arquivo.name, "Este formato não pode ser reduzido aqui; tire um print do comprovante e envie o print.");
  }
  let lado = LADO_MAXIMO;
  for (const qualidade of QUALIDADES) {
    const blob = await reducao.reencodar(arquivo, lado, qualidade);
    if (!blob) throw new ComprovanteGrandeDemais(arquivo.name, "Não consegui reduzir a imagem; tire um print do comprovante e envie o print.");
    if (blob.size <= ALVO_BYTES) {
      const nome = arquivo.name.replace(/\.[^.]+$/, "") + ".jpg";
      return new File([blob], nome, { type: "image/jpeg" });
    }
    lado = Math.round(lado * 0.8);
  }
  throw new ComprovanteGrandeDemais(arquivo.name, "Mesmo reduzida, a imagem continua grande; tire um print do comprovante e envie o print.");
}
