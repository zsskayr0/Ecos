import { Lock } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Dialog } from "@/components/common/Dialog";
import { seguro, type SeguroEstado } from "@/lib/api";
import { motivoSenha, publicarEstadoSeguro } from "@/lib/pastas-trancadas";

const CAMPO = "w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-text-primary outline-none focus:border-steel-400";

/** Pede a senha de uma pasta trancada (`pasta` de senha própria) ou a senha-mestra (sem `pasta`). */
export function DesbloquearPastaDialog({ pasta, propria, onFechar, onAberta }: { pasta?: string; propria: boolean; onFechar: () => void; onAberta?: (e: SeguroEstado) => void }) {
  const id = useId();
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    setOcupado(true); setErro(null);
    try {
      const e = await seguro.desbloquear(senha, propria ? pasta : undefined);
      publicarEstadoSeguro(e);
      onAberta?.(e);
      onFechar();
    } catch (e) { setErro(motivoSenha(e, "Não foi possível destrancar.")); setSenha(""); }
    finally { setOcupado(false); }
  }
  return (
    <Dialog rotuloId={`${id}-t`} onFechar={() => !ocupado && onFechar()}>
      <form onSubmit={enviar} className="w-full max-w-sm rounded-2xl border border-border bg-surface-1 p-5">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-2"><Lock size={20} className="text-steel-300" aria-hidden="true" /></div>
        <h2 id={`${id}-t`} className="text-lg font-semibold text-text-primary">Pasta trancada</h2>
        <p className="mb-3 mt-1 text-sm text-text-muted">{propria && pasta ? `Informe a senha da pasta “${pasta}”.` : "Informe a senha das pastas trancadas."}</p>
        <input type="password" autoComplete="off" autoFocus aria-label="Senha" placeholder="Senha" value={senha} onChange={(e) => { setSenha(e.target.value); setErro(null); }} className={CAMPO} />
        {erro && <p role="alert" className="mt-2 text-sm text-error">{erro}</p>}
        <div className="mt-5 flex gap-3">
          <button type="button" disabled={ocupado} onClick={onFechar} className="min-h-11 flex-1 rounded-xl bg-surface-2 px-4 text-sm font-medium text-text-primary disabled:opacity-40">Cancelar</button>
          <button type="submit" disabled={ocupado || !senha} className="min-h-11 flex-1 rounded-xl bg-steel-500 px-4 text-sm font-semibold text-white disabled:opacity-40">{ocupado ? "Destrancando…" : "Destrancar"}</button>
        </div>
        <p className="mt-3 text-xs text-text-muted">Esqueceu? Em Configurações › Pastas trancadas dá para criar outra senha confirmando a da conta.</p>
      </form>
    </Dialog>
  );
}

/** Põe o cadeado numa pasta: com a senha-mestra (cria na hora, se ainda não existe) ou com uma senha só dessa pasta. */
export function TrancarPastaDialog({ pasta, mestraConfigurada, onFechar, onTrancada }: { pasta: string; mestraConfigurada: boolean; onFechar: () => void; onTrancada?: (e: SeguroEstado) => void }) {
  const id = useId();
  const [modo, setModo] = useState<"mestra" | "propria">(mestraConfigurada ? "mestra" : "propria");
  const [senha, setSenha] = useState("");
  const [repete, setRepete] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const precisaSenha = modo === "propria" || !mestraConfigurada;
  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (precisaSenha && senha !== repete) { setErro("As senhas não são iguais."); return; }
    setOcupado(true); setErro(null);
    try {
      if (modo === "mestra" && !mestraConfigurada) await seguro.configurar(senha);
      const e = await seguro.trancarPasta(pasta, modo === "propria" ? { senha } : undefined);
      publicarEstadoSeguro(e);
      onTrancada?.(e);
      onFechar();
    } catch (e) { setErro(motivoSenha(e, "Não foi possível trancar a pasta.")); }
    finally { setOcupado(false); }
  }
  const opcao = (v: "mestra" | "propria", rotulo: string, texto: string) => (
    <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${modo === v ? "border-steel-400 bg-surface-2" : "border-border"}`}>
      <input type="radio" name={`${id}-modo`} checked={modo === v} onChange={() => { setModo(v); setErro(null); }} className="mt-1" />
      <span><span className="block text-sm font-medium text-text-primary">{rotulo}</span><span className="block text-xs text-text-muted">{texto}</span></span>
    </label>
  );
  return (
    <Dialog rotuloId={`${id}-t`} onFechar={() => !ocupado && onFechar()}>
      <form onSubmit={enviar} className="w-full max-w-md rounded-2xl border border-border bg-surface-1 p-5">
        <h2 id={`${id}-t`} className="text-lg font-semibold text-text-primary">Trancar “{pasta}”</h2>
        <p className="mb-3 mt-1 text-sm text-text-muted">A pasta e as pastas dentro dela ficam escondidas até a senha. Os arquivos continuam comuns no computador do servidor: o cadeado vale dentro do Ecos.</p>
        <div className="space-y-2">
          {opcao("mestra", "Senha-mestra", mestraConfigurada ? "A mesma de todas as pastas trancadas desse jeito: destrancar uma abre as outras." : "Crie uma senha para as pastas trancadas. Destrancar uma abre todas que usam ela.")}
          {opcao("propria", "Senha só desta pasta", "Abre apenas esta pasta; as outras continuam trancadas.")}
        </div>
        {precisaSenha && (
          <div className="mt-3 space-y-2">
            <input type="password" autoComplete="off" aria-label="Senha" placeholder="Senha (8 a 128 caracteres)" value={senha} onChange={(e) => { setSenha(e.target.value); setErro(null); }} className={CAMPO} />
            <input type="password" autoComplete="off" aria-label="Repita a senha" placeholder="Repita a senha" value={repete} onChange={(e) => { setRepete(e.target.value); setErro(null); }} className={CAMPO} />
          </div>
        )}
        {erro && <p role="alert" className="mt-2 text-sm text-error">{erro}</p>}
        <div className="mt-5 flex gap-3">
          <button type="button" disabled={ocupado} onClick={onFechar} className="min-h-11 flex-1 rounded-xl bg-surface-2 px-4 text-sm font-medium text-text-primary disabled:opacity-40">Cancelar</button>
          <button type="submit" disabled={ocupado || (precisaSenha && senha.length < 8)} className="min-h-11 flex-1 rounded-xl bg-steel-500 px-4 text-sm font-semibold text-white disabled:opacity-40">{ocupado ? "Trancando…" : "Trancar pasta"}</button>
        </div>
      </form>
    </Dialog>
  );
}
