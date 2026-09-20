import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { ApiError, auth } from "@/lib/api";
import logoIcone from "@/assets/brand/ecos-icone.svg";
import { AceiteTermosCampo } from "./AceiteTermosCampo";
import { DocumentoLegalDialog, type DocumentoLegal } from "./DocumentoLegalDialog";

/** Bloqueia o app depois do login enquanto a pessoa não aceitar a versão vigente dos Termos e da Política. */
export function ReaceiteTermos() {
  const { perfil, recarregarPerfil, logout } = useAuth();
  const [aceito, setAceito] = useState(false);
  const [lendo, setLendo] = useState<DocumentoLegal | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    if (!perfil?.termos_versao) return;
    setEnviando(true);
    setErro(null);
    try {
      await auth.aceitarTermos(perfil.termos_versao);
      await recarregarPerfil();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível registrar o aceite. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <img src={logoIcone} alt="" className="h-14 w-14" />
        <h1 className="font-display text-2xl text-text-primary">Termos e Política atualizados</h1>
        <p className="text-sm text-text-secondary">Para continuar usando o Ecos, leia e aceite a versão atual ({perfil?.termos_versao}).</p>
      </div>
      <AceiteTermosCampo marcado={aceito} onChange={setAceito} onLer={setLendo} />
      {erro && <p role="alert" className="text-sm text-error">{erro}</p>}
      <button
        type="button"
        disabled={!aceito || enviando}
        onClick={() => void confirmar()}
        className="rounded-2xl bg-text-primary py-3.5 text-[15px] font-semibold text-base transition-opacity disabled:opacity-40"
      >
        {enviando ? "Um momento..." : "Aceitar e continuar"}
      </button>
      <button type="button" onClick={() => void logout()} className="text-sm text-text-muted hover:text-text-primary">Sair</button>
      <DocumentoLegalDialog documento={lendo} onClose={() => setLendo(null)} />
    </main>
  );
}
