import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, AlertTriangle, Camera } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { useAuth } from "@/lib/auth-context";
import { auth, ApiError } from "@/lib/api";
import { fotoPerfil, salvarFotoPerfil } from "@/lib/profile-avatar";

/** Profile edit — only `nome_usuario` is real (`PATCH /me`); bio/handle don't exist in the backend. */
export function ProfileEditScreen() {
  const navigate = useNavigate();
  const { perfil, recarregarPerfil } = useAuth();
  const [nome, setNome] = useState(perfil?.nome_usuario ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [foto, setFoto] = useState(() => fotoPerfil(perfil?.id));

  async function escolherFoto(arquivo?: File) {
    if (!arquivo || !perfil) return;
    if (!arquivo.type.startsWith("image/")) { setErro("Escolha uma imagem."); return; }
    try { setFoto(await salvarFotoPerfil(perfil.id, arquivo)); } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível guardar a imagem."); }
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await auth.atualizarPerfil({ nome_usuario: nome.trim() });
      await recarregarPerfil();
      navigate(-1);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <button onClick={() => navigate(-1)} className="mb-4 flex items-center gap-1 text-sm text-text-muted">
        <ChevronLeft size={18} />
        Cancelar
      </button>

      <div className="mb-6 flex flex-col items-center gap-2">
        <label className="group relative cursor-pointer"><Avatar nome={nome || "?"} tamanho={72} url={foto} /><span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100"><Camera size={20} /></span><input type="file" accept="image/*" className="sr-only" onChange={(e) => void escolherFoto(e.target.files?.[0])} /></label>
        <p className="text-xs text-text-muted">Toque na foto para alterar</p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Nome de usuário</span>
        <input value={nome} onChange={(e) => setNome(e.target.value)} className="ecos-input" />
      </label>

      {erro && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}

      <button
        onClick={salvar}
        disabled={salvando || nome.trim().length < 3}
        className="mt-6 w-full rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white disabled:opacity-40"
      >
        {salvando ? "Salvando..." : "Salvar alterações"}
      </button>
    </div>
  );
}
