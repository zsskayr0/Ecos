import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { nomeExibicao, useAuth } from "@/lib/auth-context";
import { useFotoPerfil } from "@/lib/profile-avatar";
import { useAvatarEquipe } from "@/lib/team-avatar";
import { corDaEquipe } from "@/lib/team-color";

export interface Destino { espaco: string; nome: string }

function AvatarDestino({ destino, tamanho }: { destino: Destino; tamanho: number }) {
  const { perfil } = useAuth();
  const ehPessoal = destino.espaco === "pessoal";
  const idEquipe = ehPessoal ? undefined : destino.espaco.replace("equipe:", "");
  const fotoEquipe = useAvatarEquipe(idEquipe);
  const { url: fotoPessoal } = useFotoPerfil(ehPessoal ? perfil?.id : undefined, perfil?.avatar_atualizado_em);
  return <Avatar nome={ehPessoal && perfil ? nomeExibicao(perfil) : destino.nome} tamanho={tamanho} url={ehPessoal ? fotoPessoal : fotoEquipe} corFundo={idEquipe ? corDaEquipe(idEquipe) : undefined} />;
}

/** Seletor de destino do envio entre Cofres: lista com a foto de cada equipe, no lugar do `<select>` nativo. */
export function SeletorDestino({ destinos, valor, aoMudar, desabilitado }: { destinos: Destino[]; valor: string; aoMudar: (espaco: string) => void; desabilitado?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const atual = destinos.find((d) => d.espaco === valor) ?? destinos[0];
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setAberto(false); } };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla, true);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", tecla, true); };
  }, [aberto]);
  if (!atual) return null;
  return <div className="cofre-envio-select" ref={raiz}>
    <button type="button" aria-haspopup="listbox" aria-expanded={aberto} aria-label="Equipe de destino" disabled={desabilitado} onClick={() => setAberto((v) => !v)}>
      <AvatarDestino destino={atual} tamanho={24} /><span>{atual.nome}</span><ChevronDown size={14} />
    </button>
    {aberto && <div className="cofre-envio-lista" role="listbox">
      {destinos.map((d) => <button key={d.espaco} type="button" role="option" aria-selected={d.espaco === atual.espaco} onClick={() => { aoMudar(d.espaco); setAberto(false); }}>
        <AvatarDestino destino={d} tamanho={24} /><span>{d.nome}</span>{d.espaco === atual.espaco && <Check size={13} />}
      </button>)}
    </div>}
  </div>;
}
