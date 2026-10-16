import { useEffect, useState } from "react";
import { ChevronLeft, Monitor, Wifi, HelpCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { definirServidorBaseUrl, lembrarUltimoServidor, obterUltimoServidor } from "@/lib/server-config";
import { ehAndroid } from "@/lib/platform";
import { ApiError, auth } from "@/lib/api";

export type Passo = "boas-vindas" | "local" | "endereco" | "ajuda" | "sucesso";

const PROFUNDIDADE: Record<Passo, number> = { "boas-vindas": 0, local: 1, endereco: 2, ajuda: 2, sucesso: 3 };

/**
 * Estado do fluxo, mantido por quem monta o palco da introdução (`App.tsx`): assim o palco sabe em que etapa a
 * pessoa está e em que direção ela andou, e a arte de fundo não reinicia entre etapas.
 */
export function useFluxoConectar() {
  const [passo, setPassoBruto] = useState<Passo>("boas-vindas");
  const [direcao, setDirecao] = useState<"avancar" | "voltar">("avancar");
  /** "Neste computador" reusa a tela de endereço, já preenchida e testando `127.0.0.1:4090` sozinha —
   * mesmo teste nos dois casos, uma coisa a menos pra digitar errado. */
  const [valorInicial, setValorInicial] = useState<string | null>(null);
  function ir(proximo: Passo) {
    setDirecao(PROFUNDIDADE[proximo] < PROFUNDIDADE[passo] ? "voltar" : "avancar");
    setPassoBruto(proximo);
  }
  return { passo, direcao, valorInicial, setValorInicial, ir };
}

export type FluxoConectar = ReturnType<typeof useFluxoConectar>;

/**
 * First-run "onde está o seu Ecos" flow — inspired by a reference the user
 * shared (Obsidian's own "where is your vault" onboarding), adapted to
 * Ecos's real client/server split: there's no local folder for the
 * WebView to pick the way Obsidian's own process can, only a real
 * `ecos-app` somewhere to point at (`server-config.ts`). Replaces the bare
 * address field that shipped first — a real bug (a user typing
 * `192.168.x.x:7023` without `http://` silently broke every request,
 * crashing far from the cause, see `api.ts`) made clear that a single free
 * text field was the wrong shape for this decision.
 */
export function ConectarServidorScreen({ fluxo }: { fluxo: FluxoConectar }) {
  const { passo, valorInicial, setValorInicial, ir } = fluxo;
  return (
    <>
      {passo === "boas-vindas" && <BoasVindas onContinuar={() => ir("local")} />}
      {passo === "local" && (
        <Local
          onEscolherLocal={() => {
            setValorInicial("127.0.0.1:4090");
            ir("endereco");
          }}
          onEscolherRede={() => {
            setValorInicial(null);
            ir("endereco");
          }}
          onEscolherAjuda={() => ir("ajuda")}
        />
      )}
      {passo === "endereco" && <Endereco valorInicial={valorInicial} onVoltar={() => ir("local")} />}
      {passo === "ajuda" && <Ajuda onVoltar={() => ir("local")} />}
    </>
  );
}

function BoasVindas({ onContinuar }: { onContinuar: () => void }) {
  return (
    <div className="intro-cascata flex flex-col gap-8">
      <div className="text-center">
        <p className="font-display text-4xl text-text-primary">Ecos</p>
        <p className="mt-3 text-[15px] leading-snug text-text-secondary">
          Suas notas, tarefas e finanças moram num servidor que só você controla — nunca na nuvem de outra pessoa.
        </p>
        <p className="mt-2 text-sm text-text-muted">Só precisamos saber onde ele está.</p>
      </div>
      <button onClick={onContinuar} className="w-full rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-on-steel transition-transform hover:bg-steel-600 active:scale-[0.98]">
        Começar
      </button>
    </div>
  );
}

function Local({ onEscolherLocal, onEscolherRede, onEscolherAjuda }: { onEscolherLocal: () => void; onEscolherRede: () => void; onEscolherAjuda: () => void }) {
  const android = ehAndroid();
  return (
    <div className="intro-cascata flex flex-col gap-6">
      <div className="text-center">
        <p className="font-display text-2xl text-text-primary">Onde o seu Ecos está rodando?</p>
        <p className="mt-2 text-sm text-text-secondary">Dá pra trocar isso depois, em Configurações → Servidor.</p>
      </div>
      <div className="flex flex-col gap-3">
        {!android && (
          <OpcaoLocal
            Icon={Monitor}
            titulo="Neste computador"
            desc="O Ecos roda neste mesmo computador."
            onClick={onEscolherLocal}
          />
        )}
        <OpcaoLocal
          Icon={Wifi}
          titulo="Em outro endereço"
          desc="Outro computador na rede, um servidor em casa, ou uma VPN privada (Tailscale)."
          onClick={onEscolherRede}
        />
        <OpcaoLocal
          Icon={HelpCircle}
          titulo="Ainda não tenho um Ecos rodando"
          desc="Como colocar o Ecos para rodar antes de continuar."
          onClick={onEscolherAjuda}
        />
      </div>
    </div>
  );
}

function OpcaoLocal({ Icon, titulo, desc, onClick }: { Icon: typeof Monitor; titulo: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 rounded-2xl border border-border bg-surface-1 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-steel-400/50 hover:bg-surface-2 active:translate-y-0">
      <Icon size={22} strokeWidth={1.75} className="shrink-0 text-steel-300" />
      <div>
        <p className="text-[15px] font-medium text-text-primary">{titulo}</p>
        <p className="text-xs text-text-muted">{desc}</p>
      </div>
    </button>
  );
}

function Ajuda({ onVoltar }: { onVoltar: () => void }) {
  return (
    <div className="intro-cascata flex flex-col gap-6">
      <button onClick={onVoltar} className="flex w-fit items-center gap-1 text-sm text-text-muted">
        <ChevronLeft size={18} />
        Voltar
      </button>
      <div>
        <p className="mb-2 font-display text-2xl text-text-primary">Coloque o servidor do Ecos para rodar primeiro</p>
        <p className="text-[15px] leading-snug text-text-secondary">
          O Ecos guarda os seus dados no seu próprio servidor: este app é só a interface. Instale e ligue o servidor
          em algum computador (o seu, um servidor em casa ou uma VPS), seguindo o guia de instalação do projeto.
        </p>
      </div>
      <p className="text-sm text-text-secondary">Se alguém da sua equipe já cuida do servidor, peça a essa pessoa o endereço dele e use "Em outro endereço".</p>
      <p className="text-xs text-text-muted">Depois de rodando, volta aqui e escolhe "Neste computador" ou "Em outro endereço".</p>
      <button onClick={onVoltar} className="mt-2 w-full rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-on-steel">
        Voltar
      </button>
    </div>
  );
}

function Endereco({ valorInicial, onVoltar }: { valorInicial: string | null; onVoltar: () => void }) {
  const [url, setUrl] = useState(valorInicial ?? obterUltimoServidor()?.replace(/^https?:\/\//, "") ?? "");
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<"ok" | "erro" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (valorInicial) testar(valorInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valorInicial]);

  async function testar(candidato: string) {
    setTestando(true);
    setErro(null);
    setResultado(null);
    definirServidorBaseUrl(candidato);
    try {
      await auth.testarConexao();
      lembrarUltimoServidor(candidato);
      setResultado("ok");
      window.location.reload();
    } catch (e) {
      setResultado("erro");
      if (e instanceof ApiError && e.code === "SERVIDOR_INVALIDO") {
        setErro(`Esse endereço respondeu${e.status ? ` (código ${e.status})` : ""}, mas não parece ser um servidor do Ecos. Confira a porta (o padrão é 7023) e se não é outro serviço.`);
      } else {
        setErro("Não consegui alcançar esse endereço. Confira se o servidor do Ecos está ligado, se o endereço está certo e se este aparelho está na mesma rede (ou na mesma VPN).");
      }
      definirServidorBaseUrl(null);
    } finally {
      setTestando(false);
    }
  }

  return (
    <div className="intro-cascata flex flex-col gap-6">
      <button onClick={onVoltar} className="flex w-fit items-center gap-1 text-sm text-text-muted">
        <ChevronLeft size={18} />
        Voltar
      </button>

      <div>
        <p className="mb-2 font-display text-2xl text-text-primary">Qual o endereço?</p>
        <p className="text-[15px] leading-snug text-text-secondary">
          O IP do computador na rede local, ou o IP Tailscale dele. Ex: <span className="font-mono-value text-text-primary">192.168.0.5:7023</span>.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Endereço</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="192.168.0.5:7023"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus
          className="ecos-input font-mono-value"
        />
      </label>

      {resultado === "erro" && erro && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-error/40 bg-error/10 p-3 text-sm text-error">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          {erro}
        </div>
      )}
      {resultado === "ok" && (
        <div className="flex items-start gap-2 rounded-2xl border border-success/40 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" strokeWidth={1.75} />
          Conectado. Abrindo o Ecos...
        </div>
      )}

      <button
        onClick={() => testar(url)}
        disabled={testando || !url.trim()}
        className="mt-2 w-full rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-on-steel disabled:opacity-40"
      >
        {testando ? "Testando..." : "Conectar"}
      </button>
    </div>
  );
}
