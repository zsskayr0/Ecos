import { Avatar } from "@/components/common/Avatar";
import { useFotoPerfil } from "@/lib/profile-avatar";

/** Foto de perfil (ou iniciais) de quem lançou, em círculo. O nome fica na dica e, com `comNome`, ao lado. */
export function AvatarAutor({ id, nome, tamanho = 26, comNome = false }: { id?: string | null; nome?: string; tamanho?: number; comNome?: boolean }) {
  const { url } = useFotoPerfil(id ?? undefined);
  const rotulo = nome ?? "Autor desconhecido";
  return (
    <span className="cofre-autor" title={nome ? `Lançado por ${nome}` : rotulo}>
      <Avatar nome={nome ?? "?"} tamanho={tamanho} url={url} />
      {comNome && <span className="cofre-autor-nome">{nome ?? "—"}</span>}
    </span>
  );
}
