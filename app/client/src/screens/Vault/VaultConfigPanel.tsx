import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, FileSpreadsheet, Github, HelpCircle, ListTree, Lock, Settings2, ShieldCheck, X, type LucideIcon } from "lucide-react";
import { vault } from "@/lib/api";
import { tamanhoInicialDeJanela } from "@/desktop/DocumentoJanela";
import { PeriodPicker } from "./nexus/PeriodPicker";
import { defaultPeriod, periodRange, type Period } from "./nexus/period";
import { SenhaLembrada } from "./SenhaLembrada";
import { VaultSettings } from "./VaultSettings";
import { VaultCsv } from "./VaultCsv";

export type AbaConfigCofre = "geral" | "seguranca" | "cadastros" | "csv" | "github" | "ajuda";

/** Endereço do repositório do Ecos. Vazio enquanto ele não é publicado: a aba GitHub mostra o aviso em vez de um link quebrado. */
const REPOSITORIO_URL = "";

const ABAS: { id: AbaConfigCofre; rotulo: string; Icone: LucideIcon }[] = [
  { id: "geral", rotulo: "Geral", Icone: Settings2 },
  { id: "seguranca", rotulo: "Segurança", Icone: ShieldCheck },
  { id: "cadastros", rotulo: "Contas e categorias", Icone: ListTree },
  { id: "csv", rotulo: "Backup & CSV", Icone: FileSpreadsheet },
  { id: "github", rotulo: "GitHub", Icone: Github },
  { id: "ajuda", rotulo: "Ajuda & Suporte", Icone: HelpCircle },
];

const DUVIDAS: [string, string][] = [
  ["Esqueci a senha do Cofre. E agora?", "A senha do Cofre não pode ser recuperada: ela protege seus dados de ponta a ponta. Se você a perdeu, só é possível resetar o Cofre (Configurações do Ecos › Privacidade e cofre), o que apaga os lançamentos. O servidor guarda um backup de segurança antes."],
  ["Como trago meu histórico de outro app?", "Em Backup & CSV, escolha o arquivo, confira as colunas e rode a validação antes de importar. Duplicatas são ignoradas por data, tipo, valor, descrição e conta."],
  ["Posso guardar comprovantes e notas fiscais?", "Sim. Solte o arquivo na janela do Ecos (ou compartilhe pelo celular) e ele vai para Comprovantes, ligado ao lançamento certo."],
  ["O Cofre é por pessoa ou por equipe?", "Cada espaço tem o seu: trocar de equipe no menu da conta abre o Cofre daquele espaço, com senha e dados próprios."],
  ["Como bloqueio o Cofre rapidamente?", "Pela aba Segurança ou pelo menu da conta, no canto do menu lateral. Bloquear sempre pede a senha de novo."],
];

function Interruptor({ ligado, aoAlternar, rotulo }: { ligado: boolean; aoAlternar: () => void; rotulo: string }) {
  return <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} className="cofre-config-switch" onClick={aoAlternar}><i /></button>;
}

function Linha({ titulo, descricao, children }: { titulo: string; descricao?: string; children?: ReactNode }) {
  return <div className="cofre-config-row"><div><b>{titulo}</b>{descricao && <p>{descricao}</p>}</div>{children}</div>;
}

/**
 * Configurações do Cofre numa folha flutuante (vidro fosco): sem arrastar nem redimensionar,
 * com o fundo desfocado, como as Configurações do Ecos. Esc, clique fora ou o X fecham.
 */
export function VaultConfigPanel({ aba, aoTrocarAba, aoFechar, recolhido, aoAlternarMenu, atualizar }: {
  aba: AbaConfigCofre;
  aoTrocarAba: (a: AbaConfigCofre) => void;
  aoFechar: () => void;
  recolhido: boolean;
  aoAlternarMenu: () => void;
  atualizar: () => void;
}) {
  const [saindo, setSaindo] = useState(false);
  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const [bloqueando, setBloqueando] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  // Mesmo tamanho da janela de Configurações do Ecos (a mesma função que a dimensiona); no celular a folha ocupa a tela.
  const [tamanho, setTamanho] = useState(tamanhoInicialDeJanela);
  useEffect(() => { const r = () => setTamanho(tamanhoInicialDeJanela()); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
  const estiloFolha = window.innerWidth > 700 ? { width: tamanho.w, height: tamanho.h } : undefined;
  const range = periodRange(period);
  const periodo = { data_de: range.from, data_ate: range.to };
  const valido = !!periodo.data_de && !!periodo.data_ate && periodo.data_de <= periodo.data_ate;

  function fechar() { if (saindo) return; setSaindo(true); window.setTimeout(aoFechar, 170); }
  useEffect(() => { raiz.current?.focus(); }, []);
  const atual = ABAS.find(a => a.id === aba) ?? ABAS[0];

  return (
    <div ref={raiz} className="cofre-config-root" data-saindo={saindo || undefined} tabIndex={-1} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); fechar(); } }}>
      <div className="cofre-config-backdrop" onClick={fechar} />
      <div role="dialog" aria-modal="true" aria-label="Configurações do Cofre" className="cofre-config-sheet" style={estiloFolha}>
        <nav aria-label="Seções das configurações do Cofre" className="cofre-config-nav">
          <p>Cofre</p>
          {ABAS.map(({ id, rotulo, Icone }) => <button key={id} type="button" aria-current={aba === id ? "page" : undefined} onClick={() => aoTrocarAba(id)}><Icone size={16} strokeWidth={1.75} aria-hidden />{rotulo}</button>)}
        </nav>
        <section className="cofre-config-body">
          <header><h2>{atual.rotulo}</h2>{aba === "csv" && <PeriodPicker value={period} onChange={setPeriod} />}<button type="button" aria-label="Fechar configurações" title="Fechar (Esc)" onClick={fechar}><X size={16} /></button></header>
          <div className="cofre-config-scroll">
            {aba === "geral" && <>
              <Linha titulo="Menu lateral recolhido" descricao="Mostra só os ícones e libera espaço para o conteúdo. Lembrado neste aparelho."><Interruptor ligado={recolhido} aoAlternar={aoAlternarMenu} rotulo="Menu lateral recolhido" /></Linha>
              <Linha titulo="Atalhos" descricao="Esc fecha esta janela. Clicar fora dela também volta ao Cofre." />
              <Linha titulo="Cofre por espaço" descricao="Pessoal e cada equipe têm Cofre, senha e dados próprios. Troque de espaço pelo menu da conta." />
            </>}
            {aba === "seguranca" && <>
              <Linha titulo="Bloquear agora" descricao="Oculta os dados e pede a senha do Cofre para voltar."><button type="button" className="cofre-config-btn" disabled={bloqueando} onClick={async () => { setBloqueando(true); try { await vault.bloquear(); } finally { setBloqueando(false); } }}><Lock size={14} />Bloquear Cofre</button></Linha>
              <SenhaLembrada />
              <Linha titulo="Resetar o Cofre" descricao="Apagar tudo fica em Configurações do Ecos › Privacidade e cofre, com confirmação e backup de segurança." />
            </>}
            {aba === "cadastros" && <VaultSettings atualizar={atualizar} semTitulo />}
            {aba === "csv" && (valido ? <VaultCsv periodo={periodo} atualizar={atualizar} /> : <p role="alert">Selecione um período válido.</p>)}
            {aba === "github" && <div className="cofre-config-empty"><Github size={30} /><h3>Ecos no GitHub</h3>
              {REPOSITORIO_URL
                ? <><p>Código, versões e relatos de problemas do Ecos.</p><a className="cofre-config-btn" href={REPOSITORIO_URL} target="_blank" rel="noreferrer"><ExternalLink size={14} />Abrir repositório</a></>
                : <p>O repositório ainda não foi publicado. Quando for, o link aparece aqui.</p>}</div>}
            {aba === "ajuda" && <>
              {DUVIDAS.map(([p, r]) => <details key={p} className="cofre-config-faq"><summary>{p}</summary><p>{r}</p></details>)}
              <Linha titulo="Precisa de mais ajuda?" descricao="Fale com quem administra o seu servidor do Ecos: essa pessoa acessa os registros e os backups." />
            </>}
          </div>
        </section>
      </div>
    </div>
  );
}
