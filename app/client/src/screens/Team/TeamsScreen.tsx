import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, ChevronLeft, ChevronRight, Loader2, MoreHorizontal, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMinhasEquipes, type MinhaEquipe } from "@/lib/use-minhas-equipes";
import { corDaEquipe, definirCorDaEquipe } from "@/lib/team-color";
import { Avatar } from "@/components/common/Avatar";
import { PaletaCores } from "@/components/common/PaletaCores";
import { ApiError, avatarPerfil, equipes as equipesApi } from "@/lib/api";
import { limparFotoLegada, notificarFotoPerfilAtualizada, prepararFotoPerfil, useFotoPerfil } from "@/lib/profile-avatar";
import { definirAvatarEquipeLocal, useAvatarEquipe } from "@/lib/team-avatar";
import { ToggleItem } from "@/screens/Settings/SettingsScreen";
import { useAppUI } from "@/lib/ui-context";
import { useRefreshBus } from "@/lib/refresh-bus";
import { nomeExibicao, useAuth } from "@/lib/auth-context";

type Dialogo = { tipo: "renomear" | "excluir"; equipe: MinhaEquipe };
const CHAVE_COR_PESSOAL = "ecos:cor-equipe-pessoal";

/** Gerenciador único de equipes, usado tanto pelas Configurações quanto pelo seletor do menu da conta. */
export function TeamsScreen() {
  const navigate = useNavigate();
  const { intercalarEquipes, setIntercalarEquipes } = useAppUI();
  const dentro = useLocation().pathname.startsWith("/configuracoes");
  const baseEquipe = dentro ? "/configuracoes/equipes" : "/equipe";
  const { equipes, carregando } = useMinhasEquipes();
  const { notificar } = useRefreshBus();
  const { perfil, recarregarPerfil } = useAuth();
  const [menuAberto, setMenuAberto] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [corPessoal, setCorPessoal] = useState(() => { try { return localStorage.getItem(CHAVE_COR_PESSOAL) ?? "#3E6FA8"; } catch { return "#3E6FA8"; } });
  const menus = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuAberto) return;
    const fechar = (evento: PointerEvent) => { if (!menus.current?.contains(evento.target as Node)) setMenuAberto(null); };
    document.addEventListener("pointerdown", fechar);
    return () => document.removeEventListener("pointerdown", fechar);
  }, [menuAberto]);

  async function trocarFoto(equipe: MinhaEquipe, arquivo?: File) {
    if (!arquivo) return;
    setMenuAberto(null); setErro(null); setEnviandoFoto(equipe.id);
    try {
      const preparada = await prepararFotoPerfil(arquivo);
      definirAvatarEquipeLocal(equipe.id, preparada);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível alterar a foto da equipe."); }
    finally { setEnviandoFoto(null); }
  }

  async function trocarFotoPessoal(arquivo?: File) {
    if (!arquivo || !perfil) return;
    setMenuAberto(null); setErro(null); setEnviandoFoto("pessoal");
    try {
      const preparada = await prepararFotoPerfil(arquivo);
      await avatarPerfil.enviar(preparada);
      limparFotoLegada(perfil.id);
      await recarregarPerfil();
      notificarFotoPerfilAtualizada(perfil.id);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível alterar a foto pessoal."); }
    finally { setEnviandoFoto(null); }
  }

  function mudarCorPessoal(cor: string) {
    setCorPessoal(cor);
    try { localStorage.setItem(CHAVE_COR_PESSOAL, cor); } catch { /* preferência apenas desta sessão */ }
  }

  async function confirmar(valor: string) {
    if (!dialogo) return;
    setErro(null);
    try {
      if (dialogo.tipo === "renomear") await equipesApi.atualizar(dialogo.equipe.id, valor.trim());
      else await equipesApi.excluir(dialogo.equipe.id);
      setDialogo(null); notificar();
    } catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível atualizar a equipe."); }
  }

  return <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
    <div className="mb-5 flex items-center gap-2"><button data-voltar onClick={() => navigate(-1)} className="text-text-muted"><ChevronLeft size={22} /></button><h1 className="font-display text-xl text-text-primary">Equipes</h1></div>
    <div className="mb-6"><ToggleItem label="Intercalação de equipes" descricao="Exibe itens de todas as equipes e permite filtrá-los." ativo={intercalarEquipes} onChange={setIntercalarEquipes} /></div>
    {erro && <div className="mb-4 flex items-center gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-error"><AlertTriangle size={16} />{erro}</div>}
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Suas equipes</p>
    <div ref={menus} className="overflow-visible rounded-2xl bg-surface-1">
      {perfil && <LinhaPessoal nome={nomeExibicao(perfil)} perfilId={perfil.id} versaoFoto={perfil.avatar_atualizado_em} cor={corPessoal} menuAberto={menuAberto === "pessoal"} enviandoFoto={enviandoFoto === "pessoal"} onMenu={() => setMenuAberto((id) => id === "pessoal" ? null : "pessoal")} onFoto={(arquivo) => void trocarFotoPessoal(arquivo)} onCor={mudarCorPessoal} />}
      {carregando ? <p className="border-t border-border/60 px-4 py-5 text-sm text-text-muted">Carregando…</p> : equipes.map((equipe) => <LinhaEquipe key={equipe.id} equipe={equipe} menuAberto={menuAberto === equipe.id} enviandoFoto={enviandoFoto === equipe.id} onAbrir={() => navigate(`${baseEquipe}/${equipe.id}`)} onMenu={() => setMenuAberto((id) => id === equipe.id ? null : equipe.id)} onFoto={(arquivo) => void trocarFoto(equipe, arquivo)} onRenomear={() => { setDialogo({ tipo: "renomear", equipe }); setMenuAberto(null); }} onExcluir={() => { setDialogo({ tipo: "excluir", equipe }); setMenuAberto(null); }} />)}
    </div>
    <button onClick={() => navigate(`${baseEquipe}/nova`)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm font-medium text-steel-300 hover:bg-surface-1"><Plus size={17} />Criar ou entrar em uma equipe</button>
    <p className="mt-4 flex items-center gap-2 text-xs text-text-muted"><Users size={14} />Dono e administradores podem editar a equipe; somente o dono pode excluí-la.</p>
    {dialogo && <DialogoEquipe dialogo={dialogo} onFechar={() => setDialogo(null)} onConfirmar={confirmar} />}
  </div>;
}

function LinhaPessoal({ nome, perfilId, versaoFoto, cor, menuAberto, enviandoFoto, onMenu, onFoto, onCor }: { nome: string; perfilId: string; versaoFoto: number | null; cor: string; menuAberto: boolean; enviandoFoto: boolean; onMenu: () => void; onFoto: (arquivo?: File) => void; onCor: (cor: string) => void }) {
  const { url: foto } = useFotoPerfil(perfilId, versaoFoto);
  const [corTemporaria, setCorTemporaria] = useState(cor);
  useEffect(() => { if (menuAberto) setCorTemporaria(cor); }, [cor, menuAberto]);
  return <div className="relative flex items-center gap-2 border-b border-border/60 px-3 py-2">
    <div className="flex min-w-0 flex-1 items-center gap-3 p-1"><span className="relative"><Avatar nome={nome} corFundo={menuAberto ? corTemporaria : cor} tamanho={38} url={foto} />{enviandoFoto && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white"><Loader2 size={15} className="animate-spin" /></span>}</span><span className="min-w-0 flex-1"><span className="block truncate text-[15px] text-text-primary">Pessoal</span><span className="text-xs text-text-muted">Equipe pessoal · fixa</span></span></div>
    <button type="button" onClick={onMenu} aria-label="Personalizar equipe Pessoal" aria-expanded={menuAberto} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><MoreHorizontal size={18} /></button>
    {menuAberto && <div className="ecos-menu absolute right-2 top-full z-40 -mt-1 w-64 rounded-xl border border-border bg-surface-1 p-1 shadow-nav">
      <label className="ecos-menu-item flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-text-secondary hover:bg-surface-2 hover:text-text-primary"><Camera size={15} />Trocar foto<input type="file" accept="image/*" className="sr-only" onChange={(e) => { onFoto(e.target.files?.[0]); e.currentTarget.value = ""; }} /></label>
      <div className="border-t border-border/60 px-2 py-2"><p className="mb-2 text-xs font-medium text-text-muted">Cor da equipe</p><PaletaCores valor={corTemporaria} onChange={setCorTemporaria} /><button type="button" disabled={corTemporaria.toLowerCase() === cor.toLowerCase()} onClick={() => onCor(corTemporaria)} className={`mt-2 w-full rounded-lg border px-3 py-2 text-xs font-semibold transition-all duration-150 ${corTemporaria.toLowerCase() === cor.toLowerCase() ? "cursor-default border-border bg-transparent text-text-secondary" : "border-steel-500 bg-steel-600 text-white shadow-sm hover:bg-steel-500 active:scale-[0.98]"}`}>{corTemporaria.toLowerCase() === cor.toLowerCase() ? "Cor salva" : "Salvar cor"}</button></div>
    </div>}
  </div>;
}


function LinhaEquipe({ equipe, menuAberto, enviandoFoto, onAbrir, onMenu, onFoto, onRenomear, onExcluir }: { equipe: MinhaEquipe; menuAberto: boolean; enviandoFoto: boolean; onAbrir: () => void; onMenu: () => void; onFoto: (arquivo?: File) => void; onRenomear: () => void; onExcluir: () => void }) {
  const foto = useAvatarEquipe(equipe.id);
  const podeEditar = equipe.cargo === "dono" || equipe.cargo === "admin";
  const [cor, setCor] = useState(() => corDaEquipe(equipe.id));
  const [corTemporaria, setCorTemporaria] = useState(cor);
  useEffect(() => { if (menuAberto) setCorTemporaria(cor); }, [cor, menuAberto]);
  const mudou = corTemporaria.toLowerCase() !== cor.toLowerCase();
  return <div className="relative flex items-center gap-2 border-b border-border/60 px-3 py-2 last:border-0">
    <button onClick={onAbrir} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left hover:bg-surface-2"><span className="relative"><Avatar nome={equipe.nome} corFundo={menuAberto ? corTemporaria : cor} tamanho={38} url={foto} />{enviandoFoto && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white"><Loader2 size={15} className="animate-spin" /></span>}</span><span className="min-w-0 flex-1"><span className="block truncate text-[15px] text-text-primary">{equipe.nome}</span><span className="text-xs text-text-muted">{equipe.cargo}</span></span><ChevronRight size={16} className="text-text-muted" /></button>
    <button type="button" onClick={onMenu} aria-label={`Ações de ${equipe.nome}`} aria-expanded={menuAberto} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><MoreHorizontal size={18} /></button>
    {menuAberto && <div className="ecos-menu absolute right-2 top-full z-40 -mt-1 w-64 rounded-xl border border-border bg-surface-1 p-1 shadow-nav">
      {podeEditar && <>
      <label className="ecos-menu-item flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-text-secondary hover:bg-surface-2 hover:text-text-primary"><Camera size={15} />Trocar foto<input type="file" accept="image/*" className="sr-only" onChange={(e) => { onFoto(e.target.files?.[0]); e.currentTarget.value = ""; }} /></label>
      <button onClick={onRenomear} className="ecos-menu-item flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-text-secondary hover:bg-surface-2 hover:text-text-primary"><Pencil size={15} />Renomear</button>
      {equipe.cargo === "dono" && <button onClick={onExcluir} className="ecos-menu-item flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-error hover:bg-error/10"><Trash2 size={15} />Excluir equipe</button>}
      </>}
      <div className="border-t border-border/60 px-2 py-2"><p className="mb-2 text-xs font-medium text-text-muted">Cor da equipe</p><PaletaCores valor={corTemporaria} onChange={setCorTemporaria} /><button type="button" disabled={!mudou} onClick={() => { definirCorDaEquipe(equipe.id, corTemporaria); setCor(corTemporaria); }} className={`mt-2 w-full rounded-lg border px-3 py-2 text-xs font-semibold transition-all duration-150 ${!mudou ? "cursor-default border-border bg-transparent text-text-secondary" : "border-steel-500 bg-steel-600 text-white shadow-sm hover:bg-steel-500 active:scale-[0.98]"}`}>{!mudou ? "Cor salva" : "Salvar cor"}</button></div>
    </div>}
  </div>;
}

function DialogoEquipe({ dialogo, onFechar, onConfirmar }: { dialogo: Dialogo; onFechar: () => void; onConfirmar: (valor: string) => Promise<void> }) {
  const excluir = dialogo.tipo === "excluir";
  const [valor, setValor] = useState(excluir ? "" : dialogo.equipe.nome);
  const [salvando, setSalvando] = useState(false);
  const valido = excluir ? valor === dialogo.equipe.nome : valor.trim().length > 0 && valor.trim() !== dialogo.equipe.nome;
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-5" onPointerDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}><form onSubmit={(e) => { e.preventDefault(); if (!valido) return; setSalvando(true); void onConfirmar(valor).finally(() => setSalvando(false)); }} className="ecos-fade-in w-full max-w-md overflow-hidden rounded-2xl border border-border bg-base shadow-nav"><header className="flex items-center justify-between border-b border-border bg-surface-1 px-5 py-4"><div><p className={`text-xs font-semibold uppercase tracking-wide ${excluir ? "text-error" : "text-steel-300"}`}>{excluir ? "Ação irreversível" : "Equipe"}</p><h2 className="font-display text-xl text-text-primary">{excluir ? "Excluir equipe" : "Renomear equipe"}</h2></div><button type="button" onClick={onFechar} className="rounded-lg p-2 text-text-muted hover:bg-surface-2"><X size={17} /></button></header><div className="p-5"><p className="mb-3 text-sm text-text-secondary">{excluir ? <>Digite <strong className="text-text-primary">{dialogo.equipe.nome}</strong> para confirmar.</> : "Escolha um novo nome para a equipe."}</p><input autoFocus value={valor} onChange={(e) => setValor(e.target.value)} className="ecos-input w-full" /></div><footer className="flex justify-end gap-2 border-t border-border px-5 py-3"><button type="button" onClick={onFechar} className="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-2">Cancelar</button><button disabled={!valido || salvando} className={`rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-40 ${excluir ? "bg-error" : "bg-steel-600"}`}>{salvando ? "Salvando…" : excluir ? "Excluir" : "Salvar"}</button></footer></form></div>;
}
