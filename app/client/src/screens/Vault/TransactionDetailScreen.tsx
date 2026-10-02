import { useContext } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FecharDocumentoContext } from "@/lib/documento-popup";
import { EditorDeLancamento } from "./EditorDeLancamento";

/** Tela de um lançamento (rota `/cofre/transacao/:id`, ou aba/janela do desktop). A edição em si está em `EditorDeLancamento`. */
export function TransactionDetailScreen() {
  const params = useParams();
  const location = useLocation();
  // Na aba do desktop a tela vive dentro de `/cofre/*` (sem `:id` na rota): o id vem do próprio caminho.
  const id = params.id ?? (location.pathname.split("/")[2] === "transacao" ? location.pathname.split("/")[3] : undefined);
  const navigate = useNavigate();
  // Janela flutuante/aba do desktop: voltar = fechar. Sem shell desktop (mobile), volta no histórico.
  const fecharDocumento = useContext(FecharDocumentoContext);
  const voltar = () => (fecharDocumento ? fecharDocumento() : navigate(-1));
  return <EditorDeLancamento id={id} aoSalvar={voltar} aoExcluir={voltar} aoFechar={voltar} />;
}
