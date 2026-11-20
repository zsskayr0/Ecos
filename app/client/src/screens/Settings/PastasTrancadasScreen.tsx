import { useState, type FormEvent } from "react";
import { EyeOff, KeyRound, Lock, LockOpen, ShieldCheck, Timer } from "lucide-react";
import { Toggle } from "@/components/common/Toggle";
import { DesbloquearPastaDialog } from "@/components/common/DialogosPastaTrancada";
import { seguro } from "@/lib/api";
import { motivoSenha, publicarEstadoSeguro, usePastasTrancadas } from "@/lib/pastas-trancadas";
import { avisar } from "@/lib/toast";
import { Cabecalho, Linha, Secao, Seletor } from "./campos-config";

const CAMPO = "min-h-10 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-steel-400";
const BOTAO = "flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-steel-500 px-4 text-sm font-medium text-white disabled:opacity-40";
const BOTAO_SECUNDARIO = "flex min-h-9 items-center gap-1.5 rounded-lg bg-surface-2 px-3 text-xs font-medium text-text-primary hover:bg-surface-3";

const TEMPOS = [1, 5, 15, 30, 60, 240].map((m) => ({ valor: String(m), rotulo: m < 60 ? `${m} min` : `${m / 60} h` }));
const opcoesTempo = (atual: number) => (TEMPOS.some((t) => t.valor === String(atual)) ? TEMPOS : [...TEMPOS, { valor: String(atual), rotulo: `${atual} min` }]);

/** Troca a senha (com a atual) ou redefine (com a senha da conta). `pasta` ausente = senha-mestra. */
function FormSenha({ pasta, aoConcluir }: { pasta?: string; aoConcluir: () => void }) {
  const [modo, setModo] = useState<"trocar" | "esqueci">("trocar");
  const [anterior, setAnterior] = useState("");
  const [nova, setNova] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    setOcupado(true); setErro(null);
    try {
      if (modo === "trocar") await seguro.trocarSenha(anterior, nova, pasta);
      else await seguro.redefinir(anterior, nova, pasta);
      publicarEstadoSeguro(await seguro.status());
      avisar("Senha atualizada. As pastas dela ficaram trancadas.", "sucesso");
      aoConcluir();
    } catch (e) { setErro(motivoSenha(e, "Não foi possível trocar a senha.")); }
    finally { setOcupado(false); }
  }
  return (
    <form onSubmit={enviar} className="space-y-2 border-t border-border/60 px-4 py-3">
      <input type="password" autoComplete="off" aria-label={modo === "trocar" ? "Senha atual" : "Senha da conta"} placeholder={modo === "trocar" ? "Senha atual" : "Senha da sua conta Ecos"} value={anterior} onChange={(e) => setAnterior(e.target.value)} className={CAMPO} />
      <input type="password" autoComplete="off" aria-label="Nova senha" placeholder="Nova senha (8 a 128 caracteres)" value={nova} onChange={(e) => setNova(e.target.value)} className={CAMPO} />
      {erro && <p role="alert" className="text-sm text-error">{erro}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={ocupado || !anterior || nova.length < 8} className={BOTAO}>{ocupado ? "Salvando…" : modo === "trocar" ? "Trocar senha" : "Criar nova senha"}</button>
        <button type="button" onClick={() => { setModo(modo === "trocar" ? "esqueci" : "trocar"); setAnterior(""); setErro(null); }} className="text-xs text-steel-300 underline-offset-2 hover:underline">{modo === "trocar" ? "Esqueci a senha" : "Lembrei da senha"}</button>
      </div>
      {modo === "esqueci" && <p className="text-xs text-text-muted">Confirme com a senha da sua conta. Nada se perde: os textos são arquivos comuns e só o cadeado muda.</p>}
    </form>
  );
}

function CriarMestra() {
  const [senha, setSenha] = useState("");
  const [repete, setRepete] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (senha !== repete) { setErro("As senhas não são iguais."); return; }
    setOcupado(true); setErro(null);
    try { publicarEstadoSeguro(await seguro.configurar(senha)); avisar("Senha criada.", "sucesso"); }
    catch (e) { setErro(motivoSenha(e, "Não foi possível criar a senha.")); }
    finally { setOcupado(false); }
  }
  return (
    <form onSubmit={enviar} className="space-y-2 px-4 py-3">
      <p className="text-xs leading-relaxed text-text-muted">Crie uma senha para trancar pastas. Depois, no explorador de arquivos, clique com o botão direito numa pasta e escolha “Trancar com senha…”. A senha protege o acesso pelo Ecos; os arquivos continuam comuns no computador do servidor.</p>
      <input type="password" autoComplete="off" aria-label="Senha-mestra" placeholder="Senha (8 a 128 caracteres)" value={senha} onChange={(e) => setSenha(e.target.value)} className={CAMPO} />
      <input type="password" autoComplete="off" aria-label="Repita a senha" placeholder="Repita a senha" value={repete} onChange={(e) => setRepete(e.target.value)} className={CAMPO} />
      {erro && <p role="alert" className="text-sm text-error">{erro}</p>}
      <button type="submit" disabled={ocupado || senha.length < 8} className={BOTAO}><Lock size={15} />{ocupado ? "Criando…" : "Criar senha"}</button>
    </form>
  );
}

/** Configurações das pastas trancadas: senha-mestra, tempo até trancar sozinha, tarefas privadas e a lista de cadeados. */
export function PastasTrancadasScreen() {
  const estado = usePastasTrancadas();
  const [trocando, setTrocando] = useState<string | null>(null);
  const [destrancando, setDestrancando] = useState<{ pasta: string; propria: boolean } | null>(null);

  async function agir(fn: () => Promise<unknown>, erro: string) {
    try { const r = await fn(); if (r && typeof r === "object" && "pastas" in r) publicarEstadoSeguro(r as never); }
    catch (e) { avisar(motivoSenha(e, erro), "erro"); }
  }

  if (!estado) return <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe"><Cabecalho titulo="Pastas trancadas" /><p className="text-sm text-text-muted">Carregando…</p></div>;
  const { mestra } = estado;
  const algumaAberta = estado.pastas.some((p) => p.aberta);

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Pastas trancadas" />
      <p className="mb-4 text-sm text-text-muted">Tranque uma pasta (e as pastas dentro dela) com senha: ela continua na lista, com um cadeado, mas o conteúdo some das notas, tarefas, busca, feed, métricas e exportações até você destrancar.</p>

      <Secao titulo="Senha-mestra">
        {!mestra.configurada ? <CriarMestra /> : (
          <>
            <Linha Icone={ShieldCheck} titulo="Senha-mestra" descricao="Vale para todas as pastas trancadas sem senha própria: destrancar uma abre todas.">
              <button type="button" onClick={() => setTrocando(trocando === "" ? null : "")} className={BOTAO_SECUNDARIO}><KeyRound size={14} />Trocar</button>
            </Linha>
            {trocando === "" && <FormSenha aoConcluir={() => setTrocando(null)} />}
            <Linha Icone={Timer} titulo="Trancar sozinha após" descricao="Tempo sem usar o Ecos até as pastas da senha-mestra fecharem de novo.">
              <Seletor<string> label="Tempo até trancar" valor={String(mestra.minutos)} opcoes={opcoesTempo(mestra.minutos)} onChange={(v) => void agir(() => seguro.configurarTempo({ minutos: Number(v) }), "Não foi possível salvar o tempo.")} />
            </Linha>
          </>
        )}
      </Secao>

      <Secao titulo="Tarefas">
        <Linha Icone={EyeOff} titulo="Mostrar tarefas de pastas trancadas" descricao="Desligado: somem de todo lugar. Ligado: aparecem como “Tarefa privada” (sem título, só o dia e a hora) na Agenda e no Hoje.">
          <Toggle checked={estado.mostrar_tarefas} label="Mostrar tarefas de pastas trancadas" onChange={(v) => void agir(() => seguro.configurarTempo({ mostrar_tarefas: v }), "Não foi possível salvar.")} />
        </Linha>
      </Secao>

      <Secao titulo="Pastas com cadeado">
        {estado.pastas.length === 0 ? (
          <p className="px-4 py-4 text-sm text-text-muted">Nenhuma pasta trancada ainda. No explorador de arquivos, clique com o botão direito numa pasta e escolha “Trancar com senha…”.</p>
        ) : estado.pastas.map((p) => (
          <div key={p.pasta} className="border-b border-border/60 last:border-0">
            <div className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-3 text-sm">
              {p.aberta ? <LockOpen size={17} className="shrink-0 text-steel-300" aria-hidden="true" /> : <Lock size={17} className="shrink-0 text-steel-300" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-text-primary">{p.pasta.split("/").join(" / ")}</span>
                <span className="block text-xs text-text-muted">{p.propria ? "Senha própria" : "Senha-mestra"} · {p.aberta ? "aberta" : "trancada"}</span>
              </span>
              {p.propria && <Seletor<string> label={`Tempo de ${p.pasta}`} valor={String(p.minutos)} opcoes={opcoesTempo(p.minutos)} onChange={(v) => void agir(() => seguro.configurarTempo({ minutos: Number(v), pasta: p.pasta }), "Não foi possível salvar o tempo.")} />}
              {p.aberta
                ? <button type="button" onClick={() => void agir(() => seguro.trancar(p.propria ? p.pasta : undefined), "Não foi possível trancar.")} className={BOTAO_SECUNDARIO}><Lock size={14} />Trancar agora</button>
                : <button type="button" onClick={() => setDestrancando({ pasta: p.pasta, propria: p.propria })} className={BOTAO_SECUNDARIO}><LockOpen size={14} />Destrancar</button>}
              {p.propria && <button type="button" onClick={() => setTrocando(trocando === p.pasta ? null : p.pasta)} className={BOTAO_SECUNDARIO}><KeyRound size={14} />Senha</button>}
              <button type="button" disabled={!p.aberta} title={p.aberta ? undefined : "Destranque a pasta antes"} onClick={() => void agir(() => seguro.tirarCadeado(p.pasta), "Não foi possível tirar o cadeado.")} className={`${BOTAO_SECUNDARIO} disabled:opacity-40`}>Tirar cadeado</button>
            </div>
            {trocando === p.pasta && <FormSenha pasta={p.pasta} aoConcluir={() => setTrocando(null)} />}
          </div>
        ))}
        {algumaAberta && (
          <div className="border-t border-border/60 px-4 py-3">
            <button type="button" onClick={() => void agir(() => seguro.trancar(), "Não foi possível trancar.")} className={BOTAO}><Lock size={15} />Trancar tudo agora</button>
          </div>
        )}
      </Secao>

      <p className="mt-4 text-xs leading-relaxed text-text-muted">Cadeados valem para o espaço pessoal. Para renomear, mover ou excluir uma pasta com cadeado, tire o cadeado antes. O estado “aberta” vale para a sua conta em todos os aparelhos.</p>
      {destrancando && <DesbloquearPastaDialog pasta={destrancando.pasta} propria={destrancando.propria} onFechar={() => setDestrancando(null)} />}
    </div>
  );
}
