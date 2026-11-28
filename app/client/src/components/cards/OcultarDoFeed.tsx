import { useState } from "react";
import { EyeOff } from "lucide-react";
import { feed } from "@/lib/api";
import { avisar } from "@/lib/toast";
import { useRefreshBus } from "@/lib/refresh-bus";
import { BotaoAcao, ItemMenu, MenuAcao } from "./feed-comum";

/** Botão "Não mostrar no Feed" do card: esconde só este item, a pasta dele (com subpastas) ou uma das tags. */
export function OcultarDoFeed({ id, espaco, pasta, tags = [], rotulo }: { id: string; espaco: string; pasta?: string | null; tags?: string[]; rotulo: "nota" | "tarefa" }) {
  const [aberto, setAberto] = useState(false);
  const { notificar } = useRefreshBus();
  async function ocultar(alvo: { tipo: "item" | "pasta" | "tag"; ref: string; espaco?: string }, aviso: string) {
    setAberto(false);
    // Otimista: o aviso já confirma; o Feed recarrega quando o servidor responde (e o aviso de erro substitui o de sucesso se ele recusar).
    avisar(`${aviso} Você pode desfazer em Configurações › Feed.`);
    try { await feed.ocultar(alvo, true); notificar(); } catch { avisar("Não foi possível atualizar o Feed.", "erro"); }
  }
  return (
    <>
      <BotaoAcao titulo="Não mostrar no Feed" onClick={() => setAberto((v) => !v)} ativo={aberto}><EyeOff size={15} /></BotaoAcao>
      <MenuAcao aberto={aberto} onFechar={() => setAberto(false)}>
        <ItemMenu onClick={() => void ocultar({ tipo: "item", ref: id }, `Esta ${rotulo === "nota" ? "nota" : "tarefa"} saiu do Feed.`)}>Ocultar {rotulo === "nota" ? "esta nota" : "esta tarefa"}</ItemMenu>
        {pasta && <ItemMenu onClick={() => void ocultar({ tipo: "pasta", ref: pasta, espaco }, `A pasta ${pasta} saiu do Feed.`)}>Ocultar a pasta {pasta.split("/").pop()}</ItemMenu>}
        {tags.map((t) => <ItemMenu key={t} onClick={() => void ocultar({ tipo: "tag", ref: t }, `A tag #${t} saiu do Feed.`)}>Ocultar a tag #{t}</ItemMenu>)}
      </MenuAcao>
    </>
  );
}
