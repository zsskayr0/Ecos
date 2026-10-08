import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ExternalLink, FileSpreadsheet, Github, HelpCircle, Lock, Settings2, ShieldCheck, type LucideIcon } from "lucide-react";
import { vault } from "@/lib/api";
import { useAppUI } from "@/lib/ui-context";
import { useAuth } from "@/lib/auth-context";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { useRefreshBus } from "@/lib/refresh-bus";
import { chaveDoCofre, lembrarSenha, lembrarSenhaSuportado, limparBloqueioManual } from "@/lib/cofre-lembrado";
import { VaultLockScreen } from "@/screens/Vault/VaultLockScreen";
import { SenhaLembrada } from "@/screens/Vault/SenhaLembrada";
import { VaultCsv } from "@/screens/Vault/VaultCsv";
import { PeriodPicker } from "@/screens/Vault/nexus/PeriodPicker";
import { defaultPeriod, periodRange, type Period } from "@/screens/Vault/nexus/period";

type Aba = "geral" | "seguranca" | "csv" | "github" | "ajuda";
type Estado = "carregando" | "desativado" | "ativar" | "bloqueado" | "aberto";

/** Avisa o Cofre aberto (se houver) que o menu lateral mudou. */
export const EVENTO_MENU_COFRE = "ecos:cofre-menu-recolhido";
export const CHAVE_MENU_COFRE_RECOLHIDO = "ecos:cofre:menu-recolhido";

/** Endereço do repositório do Ecos. Vazio enquanto ele não é publicado: a aba GitHub mostra o aviso em vez de um link quebrado. */
const REPOSITORIO_URL = "";

const ABAS: { id: Aba; rotulo: string; Icone: LucideIcon }[] = [
  { id: "geral", rotulo: "Geral", Icone: Settings2 },
  { id: "seguranca", rotulo: "Segurança", Icone: ShieldCheck },
  { id: "csv", rotulo: "Backup & CSV", Icone: FileSpreadsheet },
  { id: "github", rotulo: "GitHub", Icone: Github },
  { id: "ajuda", rotulo: "Ajuda & Suporte", Icone: HelpCircle },
];

const DUVIDAS: [string, string][] = [
  ["Esqueci a senha do Cofre. E agora?", "A senha do Cofre não pode ser recuperada: ela protege seus dados de ponta a ponta. Se você a perdeu, só é possível resetar o Cofre (Configurações › Privacidade e cofre), o que apaga os lançamentos. O servidor guarda um backup de segurança antes."],
  ["Como trago meu histórico de outro app?", "Em Backup & CSV, escolha o arquivo, confira as colunas e rode a validação antes de importar. Duplicatas são ignoradas por data, tipo, valor, descrição e conta."],
  ["Posso guardar comprovantes e notas fiscais?", "Sim. Solte o arquivo na janela do Ecos (ou compartilhe pelo celular) e ele vai para Comprovantes, ligado ao lançamento certo."],
  ["O Cofre é por pessoa ou por equipe?", "Cada espaço tem o seu: escolha a equipe acima para ver e ajustar o Cofre daquele espaço, com senha e dados próprios."],
  ["Como bloqueio o Cofre rapidamente?", "Pela aba Segurança ou pelo menu da conta, no canto do menu lateral do Cofre. Bloquear sempre pede a senha de novo."],
];

function lerMenuRecolhido(): boolean {
  try { return localStorage.getItem(CHAVE_MENU_COFRE_RECOLHIDO) === "1"; } catch { return false; }
}

function Interruptor({ ligado, aoAlternar, rotulo }: { ligado: boolean; aoAlternar: () => void; rotulo: string }) {
  return <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} className="cofre-config-switch" onClick={aoAlternar}><i /></button>;
}

function Linha({ titulo, descricao, children }: { titulo: string; descricao?: string; children?: ReactNode }) {
  return <div className="cofre-config-row"><div><b>{titulo}</b>{descricao && <p>{descricao}</p>}</div>{children}</div>;
}

/**
 * Categoria "Cofre" das Configurações do Ecos (a única tela de configurações, aberta do Ecos ou do Cofre).
 * As opções são por equipe: o seletor troca o espaço ativo, e o conteúdo só aparece se o Cofre daquele
 * espaço estiver destrancado; senão, pede a senha do Cofre ali mesmo.
 */
export function CofreConfigScreen() {
  const { espacoAtivo, setEspacoAtivo } = useAppUI();
  const { equipes } = useMinhasEquipes();
  const { perfil } = useAuth();
  const { notificar } = useRefreshBus();
  const [params, setParams] = useSearchParams();
  const pedida = params.get("aba") as Aba | null;
  const aba: Aba = ABAS.some((a) => a.id === pedida) ? (pedida as Aba) : "geral";
  const [estado, setEstado] = useState<Estado>("carregando");
  const [versao, setVersao] = useState(0);
  const [podeLembrar, setPodeLembrar] = useState(false);
  const [recolhido, setRecolhido] = useState(lerMenuRecolhido);
  const [bloqueando, setBloqueando] = useState(false);
  const [period, setPeriod] = useState<Period>(defaultPeriod);

  const nomeEquipe = espacoAtivo.startsWith("equipe:") ? equipes.find((e) => e.id === espacoAtivo.slice(7))?.nome ?? "Equipe" : undefined;
  const chave = perfil ? chaveDoCofre(perfil.id, espacoAtivo) : null;
  const range = periodRange(period);
  const periodo = { data_de: range.from, data_ate: range.to };
  const valido = !!periodo.data_de && !!periodo.data_ate && periodo.data_de <= periodo.data_ate;

  useEffect(() => { let v = true; void lembrarSenhaSuportado().then((ok) => { if (v) setPodeLembrar(ok); }); return () => { v = false; }; }, []);

  const verificar = useCallback(async () => {
    try {
      if (!perfil?.cofre_ativado) { setEstado("desativado"); return; }
      const cfg = await vault.config();
      setEstado(!cfg.cofre_ativado ? "ativar" : cfg.destrancado ? "aberto" : "bloqueado");
    } catch {
      setEstado("bloqueado");
    }
  }, [perfil?.cofre_ativado]);

  // Refaz a checagem ao trocar de equipe, ao destrancar e quando o Cofre é bloqueado em qualquer lugar do app.
  useEffect(() => {
    setEstado("carregando");
    void verificar();
    const bloqueado = () => setEstado("bloqueado");
    window.addEventListener("ecos:cofre-bloqueado", bloqueado);
    return () => window.removeEventListener("ecos:cofre-bloqueado", bloqueado);
  }, [verificar, espacoAtivo, versao]);

  function alternarMenu() {
    const novo = !recolhido;
    setRecolhido(novo);
    try { localStorage.setItem(CHAVE_MENU_COFRE_RECOLHIDO, novo ? "1" : "0"); } catch { /* armazenamento indisponível: vale só nesta sessão */ }
    window.dispatchEvent(new CustomEvent(EVENTO_MENU_COFRE, { detail: novo }));
  }

  const espacos = [{ id: "pessoal", nome: "Pessoal" }, ...equipes.map((e) => ({ id: `equipe:${e.id}`, nome: e.nome }))];

  return (
    <div className="cofre-app" style={{ minHeight: 0, background: "transparent" }}>
      <div className="px-6 pb-8 pt-6">
        <h1 className="font-display text-xl text-text-primary">Cofre</h1>
        <p className="mt-1 text-sm text-text-muted">As configurações do Cofre são por equipe e ficam disponíveis depois de digitar a senha do Cofre daquele espaço.</p>

        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Equipe">
          {espacos.map((o) => (
            <button key={o.id} type="button" aria-pressed={o.id === espacoAtivo} onClick={() => setEspacoAtivo(o.id)} className={`rounded-full border px-3 py-1 text-xs ${o.id === espacoAtivo ? "border-violet text-text-primary" : "border-border text-text-muted hover:text-text-primary"}`}>{o.nome}</button>
          ))}
        </div>

        {estado === "carregando" && <p className="mt-8 text-sm text-text-muted" role="status">Verificando Cofre…</p>}
        {estado === "desativado" && <p className="mt-8 text-sm text-text-muted">O módulo Cofre não está ativado nesta conta ou no servidor.</p>}
        {(estado === "bloqueado" || estado === "ativar") && (
          <VaultLockScreen
            equipe={nomeEquipe}
            primeiraVez={estado === "ativar"}
            permitirLembrar={podeLembrar}
            onSubmeter={async (senha, lembrar) => {
              if (estado === "ativar") await vault.ativar(senha); else await vault.desbloquear(senha);
              if (chave) { limparBloqueioManual(chave); if (lembrar) await lembrarSenha(chave, senha); }
              setVersao((v) => v + 1);
              notificar();
            }}
          />
        )}

        {estado === "aberto" && (
          <div className="mt-5">
            <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-border" role="tablist" aria-label="Seções do Cofre">
              {ABAS.map(({ id, rotulo, Icone }) => (
                <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setParams({ aba: id }, { replace: true })} className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${aba === id ? "border-violet font-medium text-text-primary" : "border-transparent text-text-muted hover:text-text-primary"}`}>
                  <Icone size={15} strokeWidth={1.75} aria-hidden />{rotulo}
                </button>
              ))}
              {aba === "csv" && <div className="ml-auto pb-1"><PeriodPicker value={period} onChange={setPeriod} /></div>}
            </div>
            <div className="flex flex-col gap-2.5">
              {aba === "geral" && <>
                <Linha titulo="Menu lateral recolhido" descricao="Mostra só os ícones do menu do Cofre e libera espaço para o conteúdo. Lembrado neste aparelho."><Interruptor ligado={recolhido} aoAlternar={alternarMenu} rotulo="Menu lateral recolhido" /></Linha>
                <Linha titulo="Cofre por espaço" descricao="Pessoal e cada equipe têm Cofre, senha e dados próprios. Escolha o espaço no topo desta página." />
              </>}
              {aba === "seguranca" && <>
                <Linha titulo="Bloquear agora" descricao="Oculta os dados e pede a senha do Cofre para voltar."><button type="button" className="cofre-config-btn" disabled={bloqueando} onClick={async () => { setBloqueando(true); try { await vault.bloquear(); } finally { setBloqueando(false); } }}><Lock size={14} />Bloquear Cofre</button></Linha>
                <SenhaLembrada />
                <Linha titulo="Resetar o Cofre" descricao="Apagar tudo fica em Privacidade e cofre, com confirmação e backup de segurança." />
              </>}
              {aba === "csv" && (valido ? <VaultCsv periodo={periodo} atualizar={notificar} /> : <p role="alert">Selecione um período válido.</p>)}
              {aba === "github" && <div className="cofre-config-empty"><Github size={30} /><h3>Ecos no GitHub</h3>
                {REPOSITORIO_URL
                  ? <><p>Código, versões e relatos de problemas do Ecos.</p><a className="cofre-config-btn" href={REPOSITORIO_URL} target="_blank" rel="noreferrer"><ExternalLink size={14} />Abrir repositório</a></>
                  : <p>O repositório ainda não foi publicado. Quando for, o link aparece aqui.</p>}</div>}
              {aba === "ajuda" && <>
                {DUVIDAS.map(([p, r]) => <details key={p} className="cofre-config-faq"><summary>{p}</summary><p>{r}</p></details>)}
                <Linha titulo="Precisa de mais ajuda?" descricao="Fale com quem administra o seu servidor do Ecos: essa pessoa acessa os registros e os backups." />
              </>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
