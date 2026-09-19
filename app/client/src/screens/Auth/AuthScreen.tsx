import { LogoAnimada } from "@/components/brand/LogoAnimada";
import { useEffect, useState } from "react";
import { AlertTriangle, Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { ApiError, auth } from "@/lib/api";
import logoIcone from "@/assets/brand/ecos-icone.svg";

/**
 * GAP-07: not one of the 12 screens in the front-end spec (which assumes
 * identity is already resolved) — but "identity local to the instance, no
 * cloud account" (architecture section 5.1) requires real login/register
 * for any other screen to work against the real backend. Registration is
 * only accepted while the instance has no user yet (first boot); after
 * that, `POST /auth/registrar` responds 409 and the UI already points to
 * asking for a Team invite instead of insisting on "create account".
 *
 * Same first-run UX as Jellyfin/Immich: an instance with no user yet only
 * shows the "create account" form (no "Entrar" tab to pick) — `GET
 * /auth/status` tells us that before any login attempt. Once a user
 * exists, this always resolves to `false` again (`registrar` itself
 * still 409s server-side as the real guard — this is purely about what
 * the first screen offers).
 */
export function AuthScreen() {
  const { login, registrar } = useAuth();
  const [instanciaVazia, setInstanciaVazia] = useState<boolean | null>(null);
  const [modo, setModo] = useState<"login" | "registro">("login");
  const [nomeUsuario, setNomeUsuario] = useState("");
  const [primeiroNome, setPrimeiroNome] = useState("");
  const [sobrenome, setSobrenome] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [precisaConvite, setPrecisaConvite] = useState(false);
  const [bloqueadoAte, setBloqueadoAte] = useState<number | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  // Contagem regressiva real (tela de bloqueio de celular) em vez de só
  // um texto "tente mais tarde" — o servidor manda quanto falta em
  // segundos (`retry_after_segundos`, seção rate limit).
  useEffect(() => {
    if (bloqueadoAte === null) return;
    const id = setInterval(() => setAgora(Date.now()), 250);
    return () => clearInterval(id);
  }, [bloqueadoAte]);

  const restanteSegundos = bloqueadoAte !== null ? Math.max(0, Math.ceil((bloqueadoAte - agora) / 1000)) : 0;
  useEffect(() => {
    if (bloqueadoAte !== null && restanteSegundos === 0) setBloqueadoAte(null);
  }, [bloqueadoAte, restanteSegundos]);

  useEffect(() => {
    let cancelado = false;
    auth
      .status()
      .then(({ instancia_vazia }) => {
        if (cancelado) return;
        setInstanciaVazia(instancia_vazia);
        if (instancia_vazia) setModo("registro");
      })
      .catch(() => {
        // Servidor inalcançável ou endpoint indisponível — cai no
        // comportamento anterior (mostra as duas abas) em vez de travar a
        // tela; o erro real de conexão já aparece ao tentar entrar/criar.
        if (!cancelado) setInstanciaVazia(false);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErroLocal(null);
    setCarregando(true);
    try {
      if (modo === "login") {
        await login(nomeUsuario, senha);
      } else {
        const nomeCompleto = `${primeiroNome.trim()} ${sobrenome.trim()}`.trim();
        const { recovery_key } = await registrar(nomeUsuario, senha, nomeCompleto);
        setRecoveryKey(recovery_key);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409) setPrecisaConvite(true);
        if (e.status === 429 && e.retryAfterSegundos) {
          setBloqueadoAte(Date.now() + e.retryAfterSegundos * 1000);
          setAgora(Date.now());
        }
        setErroLocal(e.campos?.map((c) => `${c.campo}: ${c.motivo}`).join(" · ") || e.message);
      } else {
        setErroLocal("Não foi possível conectar ao ecos-app. Ele está rodando?");
      }
    } finally {
      setCarregando(false);
    }
  }

  if (recoveryKey) {
    return <RecoveryKeyReveal recoveryKey={recoveryKey} />;
  }

  return (
    <div className="min-h-screen bg-base lg:grid lg:h-screen lg:grid-cols-[minmax(0,1fr)_minmax(440px,540px)] lg:overflow-hidden">
      <AuthArt />

      {/* Só esta coluna rola (cadastro é mais alto que o login) — a arte fica fixa na altura da janela. */}
      <div className="flex min-h-screen flex-col overflow-y-auto px-6 py-10 lg:min-h-0 lg:px-14">
        <div className="mx-auto my-auto flex w-full max-w-sm flex-col gap-7">
          <div className="flex flex-col items-center gap-3 text-center">
            <img src={logoIcone} alt="" className="h-16 w-16" />
            <p className="font-display text-3xl font-bold text-text-primary">Ecos</p>
          </div>

          {instanciaVazia ? (
            <p className="text-center text-sm text-text-secondary">
              Esta é uma instância nova — crie a primeira conta, que se torna a administradora.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-1 p-1">
              {(["login", "registro"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModo(m)}
                  className={`rounded-xl py-2.5 text-sm font-semibold transition-colors ${
                    modo === m ? "bg-surface-3 text-text-primary" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {m === "login" ? "Entrar" : "Criar conta"}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {modo === "registro" && (
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-2">
                  <span className="text-sm font-semibold text-text-primary">Nome</span>
                  <input value={primeiroNome} onChange={(e) => setPrimeiroNome(e.target.value)} className="ecos-input" placeholder="Seu nome" autoFocus />
                </label>
                <label className="flex flex-1 flex-col gap-2">
                  <span className="text-sm font-semibold text-text-primary">Sobrenome</span>
                  <input value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} className="ecos-input" placeholder="Sobrenome" />
                </label>
              </div>
            )}
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-text-primary">Usuário</span>
              <input
                value={nomeUsuario}
                onChange={(e) => setNomeUsuario(e.target.value)}
                className="ecos-input"
                placeholder="Seu usuário"
                autoComplete="username"
                autoFocus={modo === "login"}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-text-primary">Senha</span>
              <div className="relative">
                <input
                  type={mostrarSenha ? "text" : "password"}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value.replace(/\s/g, ""))}
                  onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}
                  className="ecos-input pr-12"
                  placeholder="Sua senha (sem espaços)"
                  autoComplete={modo === "login" ? "current-password" : "new-password"}
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha((v) => !v)}
                  aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                >
                  {mostrarSenha ? <Eye size={18} strokeWidth={1.75} /> : <EyeOff size={18} strokeWidth={1.75} />}
                </button>
              </div>
              {modo === "registro" && <span className="text-xs text-text-muted">Mínimo 8 caracteres.</span>}
            </label>

            {bloqueadoAte !== null ? (
              <div className="flex flex-col items-center gap-1 rounded-2xl border border-error/40 bg-error/10 p-4 text-center">
                <AlertTriangle size={18} className="text-error" strokeWidth={1.75} />
                <p className="text-sm text-error">Muitas tentativas em pouco tempo.</p>
                <p className="font-mono-value text-2xl tabular-nums text-text-primary">
                  {String(Math.floor(restanteSegundos / 60)).padStart(2, "0")}:{String(restanteSegundos % 60).padStart(2, "0")}
                </p>
                <p className="text-xs text-text-muted">Tente de novo quando o contador zerar.</p>
              </div>
            ) : (
              erroLocal && (
                <div className="flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
                  <span>
                    {erroLocal}
                    {precisaConvite && " Peça um convite de Equipe pra alguém que já tem conta nesta instância."}
                  </span>
                </div>
              )
            )}

            <button
              type="submit"
              disabled={
                carregando ||
                bloqueadoAte !== null ||
                !nomeUsuario.trim() ||
                senha.length < (modo === "registro" ? 8 : 1) ||
                (modo === "registro" && (!primeiroNome.trim() || !sobrenome.trim()))
              }
              className="mt-1 rounded-2xl bg-text-primary py-3.5 text-center font-body text-[15px] font-semibold text-base transition-opacity disabled:opacity-40"
            >
              {carregando ? "Um momento..." : modo === "login" ? "Entrar" : "Criar conta"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const CURVAS = [
  { d: "M -60 990 C 170 830, 300 650, 470 520 S 700 300, 880 240", cor: "var(--ecos-cyan)", duracao: "9s", atraso: "0s" },
  { d: "M 40 1010 C 250 870, 380 700, 545 600 S 770 420, 900 390", cor: "var(--ecos-violet)", duracao: "11s", atraso: "-4s" },
  { d: "M -140 900 C 50 760, 240 730, 380 560 S 620 210, 840 110", cor: "var(--ecos-steel-400)", duracao: "13s", atraso: "-8s" },
];

/** Cada camada é um trecho da curva com o mesmo ponto de frente — juntas formam um cometa que esmaece na cauda. */
const CAMADAS = [
  { comprimento: 0.4, opacidade: 0.12, largura: 2 },
  { comprimento: 0.24, opacidade: 0.24, largura: 2 },
  { comprimento: 0.12, opacidade: 0.45, largura: 2.2 },
  { comprimento: 0.04, opacidade: 0.95, largura: 2.6 },
];
const COMPRIMENTO_MAX = 0.4;

/** Painel decorativo — só em telas largas; sempre escuro (é arte, não acompanha o tema), com curvas de luz na paleta da marca. */
function AuthArt() {
  return (
    <div aria-hidden className="auth-arte relative hidden overflow-hidden lg:block">
      <div className="auth-arte-brilho auth-arte-brilho-a" />
      <div className="auth-arte-brilho auth-arte-brilho-b" />

      <svg viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <filter id="brilho" filterUnits="userSpaceOnUse" x="-200" y="-200" width="1200" height="1400">
            <feGaussianBlur stdDeviation="5" result="desfoque" />
            <feMerge>
              <feMergeNode in="desfoque" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {CURVAS.map((curva) => (
          <g key={curva.d} style={{ color: curva.cor }}>
            <path d={curva.d} pathLength={1} className="auth-linha-base" />
            <g filter="url(#brilho)">
              {CAMADAS.map((camada) => (
                <path
                  key={camada.comprimento}
                  d={curva.d}
                  pathLength={1}
                  className="auth-linha-luz"
                  style={
                    {
                      strokeDasharray: `${camada.comprimento} 3`,
                      strokeOpacity: camada.opacidade,
                      strokeWidth: camada.largura,
                      "--de": camada.comprimento,
                      "--ate": camada.comprimento - (1 + COMPRIMENTO_MAX),
                      animationDuration: curva.duracao,
                      animationDelay: curva.atraso,
                    } as React.CSSProperties
                  }
                />
              ))}
            </g>
          </g>
        ))}
      </svg>
      <LogoAnimada tamanho={77} className="absolute left-12 top-12" />

      <div className="auth-arte-vinheta" />
      <p className="absolute bottom-10 left-10 max-w-xs font-display text-2xl font-bold leading-snug text-white/90">
        Seu cofre vivo de notas, tempo e dinheiro.
      </p>
    </div>
  );
}

function RecoveryKeyReveal({ recoveryKey }: { recoveryKey: string }) {
  const { recarregarPerfil } = useAuth();
  const [copiado, setCopiado] = useState(false);
  const [confirmado, setConfirmado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopiado(true);
    } catch {
      /* clipboard unavailable — the user copies it manually from the screen */
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning/15">
          <KeyRound size={26} strokeWidth={1.5} className="text-warning" />
        </div>
        <p className="font-display text-2xl text-text-primary">Guarde sua recovery key</p>
        <p className="max-w-sm text-sm text-text-secondary">
          Ela só aparece essa vez. O Ecos não guarda em texto simples — sem ela, perder a senha significa perder o
          acesso à conta.
        </p>
      </div>

      <div className="rounded-2xl border border-warning/30 bg-surface-1 p-4">
        <p className="break-words font-mono-value text-[15px] leading-relaxed text-text-primary">{recoveryKey}</p>
      </div>

      <button
        onClick={copiar}
        className="flex items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3 text-sm font-semibold text-text-primary"
      >
        <Copy size={15} />
        {copiado ? "Copiada" : "Copiar"}
      </button>

      <label className="flex items-center gap-2.5 text-sm text-text-secondary">
        <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} className="accent-steel-400" />
        Já guardei essa chave num lugar seguro.
      </label>

      <button
        onClick={recarregarPerfil}
        disabled={!confirmado}
        className="rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white disabled:opacity-40"
      >
        Continuar
      </button>
    </div>
  );
}
