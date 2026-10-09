import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CircleDashed, ExternalLink, FileSpreadsheet, Github, HelpCircle, Lock, ShieldCheck, type LucideIcon } from "lucide-react";
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
import { TELAS_VALORES, salvarModoValor, useExibicaoValores, type ModoValor } from "@/lib/exibicao-valores";
import { IndicadorValor } from "@/screens/Vault/nexus/IndicadorValor";

const MODOS_VALOR: { id: ModoValor; rotulo: string }[] = [{ id: "numero", rotulo: "Número" }, { id: "barra", rotulo: "Barra" }, { id: "anel", rotulo: "Anel" }];

/** Escolha por tela de como o valor aparece: só o número, com barra ou com anel. Fica neste dispositivo; não depende do Cofre estar aberto. */
function ExibicaoValores() {
  const atual = useExibicaoValores();
  return (
    <div className="mt-5 flex flex-col gap-2.5">
      <p className="text-sm text-text-muted">Barra e anel mostram o valor em relação ao maior valor da tela no período selecionado.</p>
      {TELAS_VALORES.map((t) => (
        <Linha key={t.id} titulo={t.rotulo}>
          <div role="radiogroup" aria-label={`Exibição de valores em ${t.rotulo}`} className="flex gap-1.5">
            {MODOS_VALOR.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={atual[t.id] === m.id} className="cofre-config-btn" data-ativa={atual[t.id] === m.id || undefined}
                style={atual[t.id] === m.id ? { outline: "2px solid var(--cofre-accent, #3b82f6)" } : undefined} onClick={() => salvarModoValor(t.id, m.id)}>
                {m.id === "numero" ? "42" : <IndicadorValor modo={m.id} valor={60} max={100} />}{m.rotulo}
              </button>
            ))}
          </div>
        </Linha>
      ))}
    </div>
  );
}

export type Aba = "seguranca" | "valores" | "csv" | "github" | "ajuda";
type Estado = "carregando" | "desativado" | "ativar" | "bloqueado" | "aberto";

/** Endereço do repositório do Ecos. Vazio enquanto ele não é publicado: a aba GitHub mostra o aviso em vez de um link quebrado. */
const REPOSITORIO_URL = "";

export const ABAS_COFRE: { id: Aba; rotulo: string; Icone: LucideIcon }[] = [
  { id: "seguranca", rotulo: "Segurança", Icone: ShieldCheck },
  { id: "valores", rotulo: "Exibição de valores", Icone: CircleDashed },
  { id: "csv", rotulo: "Backup & CSV", Icone: FileSpreadsheet },
  { id: "github", rotulo: "GitHub", Icone: Github },
  { id: "ajuda", rotulo: "Ajuda & Suporte", Icone: HelpCircle },
];

const DUVIDAS: [string, string][] = [
  ["Esqueci a senha do Cofre. E agora?", "A senha do Cofre não pode ser recuperada: ela protege seus dados de ponta a ponta. Se você a perdeu, só é possível resetar o Cofre (Configurações › Privacidade e cofre), o que apaga os lançamentos. O servidor guarda um backup de segurança antes."],
  ["Como trago meu histórico de outro app?", "Em Backup & CSV, escolha o arquivo, confira as colunas e rode a validação antes de importar. Duplicatas são ignoradas por data, tipo, valor, descrição e conta."],
  ["Posso guardar comprovantes e notas fiscais?", "Sim. Solte o arquivo na janela do Ecos (ou compartilhe pelo celular) e ele vai para Comprovantes, ligado ao lançamento certo."],
  ["O Cofre é por pessoa ou por equipe?", "Cada espaço tem o seu: troque de equipe no menu lateral do Ecos para ajustar o Cofre daquele espaço, com senha e dados próprios."],
  ["Como bloqueio o Cofre rapidamente?", "Pela aba Segurança ou pelo menu da conta, no canto do menu lateral do Cofre. Bloquear sempre pede a senha de novo."],
];

function Linha({ titulo, descricao, children }: { titulo: string; descricao?: string; children?: ReactNode }) {
  return <div className="cofre-config-row"><div><b>{titulo}</b>{descricao && <p>{descricao}</p>}</div>{children}</div>;
}

/**
 * Categoria "Cofre" das Configurações do Ecos (a única tela de configurações, aberta do Ecos ou do Cofre).
 * As opções são por equipe: o seletor troca o espaço ativo, e o conteúdo só aparece se o Cofre daquele
 * espaço estiver destrancado; senão, pede a senha do Cofre ali mesmo.
 */
export function CofreConfigScreen({ aba }: { aba: Aba }) {
  const { espacoAtivo } = useAppUI();
  const { equipes } = useMinhasEquipes();
  const { perfil } = useAuth();
  const { notificar } = useRefreshBus();
  const [estado, setEstado] = useState<Estado>("carregando");
  const [versao, setVersao] = useState(0);
  const [podeLembrar, setPodeLembrar] = useState(false);
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

  return (
    <div className="cofre-app" style={{ minHeight: 0, background: "transparent" }}>
      <div className="px-6 pb-8 pt-6">
        <h1 className="font-display text-xl text-text-primary">{ABAS_COFRE.find((a) => a.id === aba)?.rotulo}{nomeEquipe ? ` · ${nomeEquipe}` : ""}</h1>
        
        {aba === "valores" && <ExibicaoValores />}
        {aba !== "valores" && estado === "carregando" && <p className="mt-8 text-sm text-text-muted" role="status">Verificando Cofre…</p>}
        {aba !== "valores" && estado === "desativado" && <p className="mt-8 text-sm text-text-muted">O módulo Cofre não está ativado nesta conta ou no servidor.</p>}
        {aba !== "valores" && (estado === "bloqueado" || estado === "ativar") && (
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

        {aba !== "valores" && estado === "aberto" && (
          <div className="mt-5">
            {aba === "csv" && <div className="mb-3"><PeriodPicker value={period} onChange={setPeriod} /></div>}
            <div className="flex flex-col gap-2.5">
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
