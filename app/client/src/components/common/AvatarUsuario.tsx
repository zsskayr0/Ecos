import { Avatar } from "./Avatar";
import { useFotoPerfil } from "@/lib/profile-avatar";

interface Props {
  /** Id da pessoa; sem ele (autor desconhecido) só as iniciais aparecem. */
  usuarioId?: string | null;
  nome: string;
  corFundo?: string;
  tamanho?: number;
}

/** Avatar de uma pessoa com a foto guardada no servidor (cai nas iniciais sem foto). */
export function AvatarUsuario({ usuarioId, nome, corFundo, tamanho }: Props) {
  const { url } = useFotoPerfil(usuarioId ?? undefined);
  return <Avatar nome={nome} corFundo={corFundo} tamanho={tamanho} url={url} />;
}
