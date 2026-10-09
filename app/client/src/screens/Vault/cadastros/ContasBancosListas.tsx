import { useMemo, useState } from "react";
import { ChevronDown, Landmark, Plus, Wallet } from "lucide-react";
import type { ContaApi } from "@/lib/api";
import { casaBusca } from "@/lib/texto-busca";
import { BANCOS, ROTULO_TIPO, bancoPorCodigo, buscarBancos, type Banco } from "../contas/bancos";
import type { BancoPreSelecionado } from "../contas/ContaModal";
import { SeloConta } from "../contas/SeloConta";
import { CabecalhoLista, CampoBusca, ErroLista, Esqueleto, Vazio } from "./CadastroLista";

export interface DadosContas { contas: ContaApi[] | null; erro: string | null; recarregar: () => void }

function descricaoConta(c: ContaApi): string {
  return [c.banco, ROTULO_TIPO[c.tipo]].filter(Boolean).join(" · ");
}

export function ContasLista({ dados, aoEditar, aoNovo }: { dados: DadosContas; aoEditar: (c: ContaApi) => void; aoNovo: () => void }) {
  const [busca, setBusca] = useState("");
  const visiveis = useMemo(() => (dados.contas ?? []).filter((c) => casaBusca(busca, `${c.nome} ${c.banco ?? ""}`)), [dados.contas, busca]);
  if (dados.erro && !dados.contas) return <ErroLista mensagem={dados.erro} aoTentar={dados.recarregar} />;
  if (!dados.contas) return <Esqueleto rotulo="Carregando contas" />;
  return (
    <section aria-label="Contas">
      <CabecalhoLista titulo="Contas" contagem={`${dados.contas.length} cadastradas`}>
        <CampoBusca valor={busca} aoMudar={setBusca} rotulo="Buscar conta ou banco" />
      </CabecalhoLista>
      {visiveis.length === 0 ? (
        <Vazio icone={<Wallet size={30} aria-hidden />} titulo={busca ? "Nenhuma conta encontrada" : "Nenhuma conta cadastrada"} texto={busca ? "Tente outro nome ou banco." : "Cadastre a primeira conta para ligar seus lançamentos a ela."}
          acao={<button type="button" className="cofre-solid" onClick={aoNovo}><Plus size={14} aria-hidden />Nova conta</button>} />
      ) : (
        <ul className="cofre-card cad-lista">
          {visiveis.map((c) => (
            <li key={c.id} className="cad-linha">
              <button type="button" className="cad-linha-principal" aria-label={`Editar conta ${c.nome}`} onClick={() => aoEditar(c)}>
                <SeloConta nome={c.nome} cor={c.cor} tipo={c.tipo} codigoBanco={c.codigo_banco} sigla={c.sigla} />
                <span className="cad-linha-texto">
                  <span className="cad-linha-nome"><b>{c.nome}</b>{c.padrao && <em>Padrão</em>}</span>
                  <small>{descricaoConta(c) || "Conta sem banco"}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface GrupoBanco {
  chave: string;
  nome: string;
  banco: BancoPreSelecionado | null;
  contas: ContaApi[];
}

/** Agrupa as contas pelo banco: código do catálogo, ou nome (banco personalizado, sem acento/caixa), ou "sem banco". */
export function agruparPorBanco(contas: ContaApi[]): GrupoBanco[] {
  const grupos = new Map<string, GrupoBanco>();
  for (const c of contas) {
    const catalogo = bancoPorCodigo(c.codigo_banco);
    const nomeNorm = (c.banco ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
    const chave = catalogo ? `cod:${catalogo.codigo}` : nomeNorm ? `nome:${nomeNorm}` : "sem";
    let g = grupos.get(chave);
    if (!g) {
      g = {
        chave,
        nome: catalogo?.nome ?? (c.banco?.trim() || "Sem banco (carteira ou dinheiro)"),
        banco: catalogo ? { codigo: catalogo.codigo } : nomeNorm ? { nome: c.banco, codigo: c.codigo_banco, sigla: c.sigla } : null,
        contas: [],
      };
      grupos.set(chave, g);
    }
    g.contas.push(c);
  }
  return [...grupos.values()].sort((a, b) => (a.chave === "sem" ? 1 : b.chave === "sem" ? -1 : a.nome.localeCompare(b.nome, "pt-BR")));
}

/** Bancos não têm cadastro próprio: o banco é parte da conta. Aqui eles aparecem agrupados e a ação é adicionar/editar contas. */
export function BancosLista({ dados, aoEditar, aoNovaConta }: { dados: DadosContas; aoEditar: (c: ContaApi) => void; aoNovaConta: (banco?: BancoPreSelecionado) => void }) {
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const grupos = useMemo(() => agruparPorBanco(dados.contas ?? []).filter((g) => casaBusca(busca, `${g.nome} ${g.contas.map((c) => c.nome).join(" ")}`)), [dados.contas, busca]);
  const catalogo = useMemo(() => (busca.trim() ? buscarBancos(busca) : BANCOS.filter((b) => b.grupo === "grandes")).slice(0, 12), [busca]);
  if (dados.erro && !dados.contas) return <ErroLista mensagem={dados.erro} aoTentar={dados.recarregar} />;
  if (!dados.contas) return <Esqueleto rotulo="Carregando bancos" />;
  const alternar = (chave: string) => setAbertos((s) => { const n = new Set(s); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; });
  const usados = new Set(grupos.map((g) => g.chave));
  return (
    <section aria-label="Bancos">
      <CabecalhoLista titulo="Bancos" contagem={`${grupos.length} em uso`}>
        <CampoBusca valor={busca} aoMudar={setBusca} rotulo="Buscar banco ou conta" />
      </CabecalhoLista>
      <p className="cad-nota">O banco faz parte da conta. Aqui você vê os bancos que usa e adiciona uma conta em qualquer banco do catálogo.</p>
      {grupos.length === 0 ? (
        <Vazio icone={<Landmark size={30} aria-hidden />} titulo={busca ? "Nenhum banco em uso encontrado" : "Nenhum banco em uso"} texto="Adicione uma conta em um banco do catálogo abaixo." />
      ) : (
        <ul className="cofre-card cad-lista">
          {grupos.map((g) => {
            const aberto = abertos.has(g.chave);
            const primeira = g.contas[0]!;
            return (
              <li key={g.chave} className="cad-grupo">
                <div className="cad-linha">
                  <button type="button" className="cad-linha-principal" aria-expanded={aberto} aria-controls={`banco-${g.chave}`} onClick={() => alternar(g.chave)}>
                    <SeloConta nome={g.nome} cor={primeira.cor} tipo={g.chave === "sem" ? "carteira" : primeira.tipo} codigoBanco={primeira.codigo_banco} sigla={primeira.sigla} />
                    <span className="cad-linha-texto">
                      <span className="cad-linha-nome"><b>{g.nome}</b></span>
                      <small>{g.contas.length} {g.contas.length === 1 ? "conta" : "contas"}</small>
                    </span>
                    <ChevronDown size={15} aria-hidden className="cad-seta" data-aberto={aberto || undefined} />
                  </button>
                  <button type="button" className="cofre-secondary cad-add" onClick={() => aoNovaConta(g.banco ?? undefined)}><Plus size={13} aria-hidden />{g.banco ? "Adicionar conta neste banco" : "Adicionar conta"}</button>
                </div>
                {aberto && (
                  <ul id={`banco-${g.chave}`} className="cad-sublista" aria-label={`Contas em ${g.nome}`}>
                    {g.contas.map((c) => (
                      <li key={c.id}><button type="button" aria-label={`Editar conta ${c.nome}`} onClick={() => aoEditar(c)}><b>{c.nome}</b><small>{ROTULO_TIPO[c.tipo]}{c.padrao ? " · Padrão" : ""}</small></button></li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <h3 className="cad-subtitulo">{busca.trim() ? "Catálogo de bancos" : "Adicionar conta em outro banco"}</h3>
      <ul className="cad-catalogo" aria-label="Bancos do catálogo">
        {catalogo.filter((b: Banco) => !usados.has(`cod:${b.codigo}`)).map((b: Banco) => (
          <li key={b.codigo}>
            <button type="button" aria-label={`Adicionar conta no ${b.nome}`} onClick={() => aoNovaConta({ codigo: b.codigo })}>
              <SeloConta nome={b.curto} cor={b.cor} codigoBanco={b.codigo} tamanho="sm" />
              <span><b>{b.curto}</b><small>{b.codigo}</small></span>
              <Plus size={13} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="cofre-secondary cad-add" onClick={() => aoNovaConta()}><Plus size={13} aria-hidden />Outro banco ou carteira</button>
    </section>
  );
}
