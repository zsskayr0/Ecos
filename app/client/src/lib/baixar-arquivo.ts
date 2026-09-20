/** Entrega um `Blob` ao usuário como download (o navegador ou a webview pergunta onde salvar). */
export function baixarArquivo(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Dá tempo do download começar antes de liberar o objeto.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
