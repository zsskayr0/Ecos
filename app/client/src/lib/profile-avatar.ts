const chave = (id: string) => `ecos:avatar:${id}`;

/** Avatar local da conta. A foto fica no cache do aplicativo até o servidor
 * receber suporte a upload de perfil, sem bloquear a personalização atual. */
export function fotoPerfil(id?: string) {
  if (!id) return undefined;
  try { return localStorage.getItem(chave(id)) ?? undefined; } catch { return undefined; }
}

export function salvarFotoPerfil(id: string, arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    leitor.onload = () => { const valor = String(leitor.result); try { localStorage.setItem(chave(id), valor); resolve(valor); } catch { reject(new Error("Não foi possível guardar a imagem.")); } };
    leitor.readAsDataURL(arquivo);
  });
}
