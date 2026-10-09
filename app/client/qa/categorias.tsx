// Fixture de desenvolvimento da tela de Categorias (com subcategorias): todas as chamadas são interceptadas, nenhum dado real é acessado.
import ReactDOM from "react-dom/client";
import { useState } from "react";

import { VaultCategories } from "../src/screens/Vault/VaultCategories";
import { CampoCategoria } from "../src/screens/Vault/CampoCategoria";
import { type Period } from "../src/screens/Vault/nexus/period";
import "../src/styles/global.css";

type Cat = { id: string; nome: string; tipo: "saida" | "entrada" | "ambos"; icone: string | null; cor: string; padrao: boolean; espaco: string; pai_id: string | null };
const c = (id: string, nome: string, tipo: Cat["tipo"], icone: string, cor: string, pai_id: string | null = null): Cat => ({ id, nome, tipo, icone, cor, padrao: false, espaco: "pessoal", pai_id });
let categorias: Cat[] = [
  c("func", "Funcionários", "saida", "Users", "#f29a9f"),
  c("sal", "Salários", "saida", "Wallet", "#fda4af", "func"),
  c("ben", "Benefícios", "saida", "Gift", "#fdba74", "func"),
  c("enc", "Encargos", "saida", "Landmark", "#fcd34d", "func"),
  c("mor", "Moradia", "saida", "Home", "#6ec6ff"),
  c("alu", "Aluguel", "saida", "Key", "#93c5fd", "mor"),
  c("con", "Condomínio", "saida", "Building", "#a5b4fc", "mor"),
  c("ali", "Alimentação", "saida", "Coffee", "#e4636b"),
  c("tra", "Transporte", "saida", "Truck", "#f28fb0"),
  c("ren", "Renda", "entrada", "Briefcase", "#8fd9ac"),
  c("ext", "Renda extra", "entrada", "Wallet", "#86d7ad", "ren"),
  c("out", "Outros", "ambos", "MoreHorizontal", "#96969c"),
  c("sau", "Saúde", "saida", "Shield", "#5eead4"),
  c("ali2", "Alimentacao", "saida", "Coffee", "#f29a9f"),
  { ...c("vel", "Streaming antigo", "saida", "Tv", "#c4b5fd"), arquivada: true } as never,
];
const rs = (n: number) => Math.round(n * 100);
const base: [string, "saida" | "entrada", number, number][] = [
  ["sal", "saida", 8, 4200], ["ben", "saida", 5, 650], ["enc", "saida", 2, 1800], ["alu", "saida", 1, 2400], ["con", "saida", 1, 780], ["ali", "saida", 22, 96],
  ["tra", "saida", 14, 38], ["ren", "entrada", 2, 9000], ["ext", "entrada", 3, 420], ["out", "saida", 4, 55], ["func", "saida", 1, 300],
];
const txs: Record<string, unknown>[] = [];
let n = 0;
for (const [cat, tipo, qtd, valor] of base) {
  for (let i = 0; i < qtd; i++) {
    txs.push({ id: `t${n++}`, tipo, valor_centavos: rs(valor + ((i * 37) % 60)), moeda: "BRL", data: `2026-09-${String(1 + ((i * 3 + n) % 28)).padStart(2, "0")}`, descricao: `Lançamento ${n}`, categoria_id: cat, conta_id: null, beneficiario_id: i % 2 ? "b1" : "b2", forma_pagamento: "pix", status: "efetivada", observacoes: null, origem: "manual", conciliada: false, espaco: "pessoal", criado_em: "2026-09-01T00:00:00", atualizado_em: "2026-09-01T00:00:00" });
  }
}

window.fetch = async (input, init) => {
  const path = new URL(String(input), location.origin).pathname;
  const metodo = init?.method ?? "GET";
  const corpo = init?.body ? JSON.parse(String(init.body)) : {};
  let value: unknown;
  let status = 200;
  if (path.endsWith("/me")) value = { cofre_ativado: true };
  else if (path.endsWith("/vault/config")) value = { cofre_ativado: true, destrancado: true, saldos_por_conta: [] };
  else if (path.endsWith("/vault/categorias") && metodo === "GET") value = categorias;
  else if (path.endsWith("/vault/categorias") && metodo === "POST") { const id = `n${categorias.length}`; categorias.push(c(id, corpo.nome, corpo.tipo, corpo.icone, corpo.cor, corpo.pai_id ?? null)); value = { id }; }
  else if (/\/vault\/categorias\/[^/]+\/uso$/.test(path)) value = { transacoes: 0, recorrencias: 0, pendencias: 0, subcategorias: 0, tipos: [], amostra: [] };
  else if (/\/vault\/categorias\/[^/]+$/.test(path) && metodo === "PATCH") {
    const id = path.split("/").pop()!;
    const alvo = categorias.find((x) => x.id === id)!;
    if (corpo.pai_id) {
      const mae = categorias.find((x) => x.id === corpo.pai_id)!;
      if (mae.pai_id || categorias.some((x) => x.pai_id === id)) { status = 422; value = { message: "Subcategorias não têm subcategorias: escolha uma categoria de nível principal." }; }
      else if (mae.tipo !== "ambos" && mae.tipo !== corpo.tipo) { status = 422; value = { message: "O tipo da subcategoria precisa ser o mesmo da categoria-mãe (ou a mãe ser “Ambas”)." }; }
    }
    if (status === 200) { Object.assign(alvo, { nome: corpo.nome, tipo: corpo.tipo, icone: corpo.icone, cor: corpo.cor, pai_id: corpo.pai_id ?? null }); value = { ok: true }; }
  } else if (/\/vault\/categorias\/[^/]+$/.test(path) && metodo === "DELETE") { const id = path.split("/").pop()!; categorias = categorias.filter((x) => x.id !== id).map((x) => (x.pai_id === id ? { ...x, pai_id: null } : x)); value = { ok: true }; }
  else if (path.endsWith("/vault/beneficiarios")) value = [{ id: "b1", nome: "Mercado Extra" }, { id: "b2", nome: "Paula Dária" }];
  else if (path.endsWith("/vault/categorias/sugestao")) value = { categoria_id: "ali", motivo: "pagador", usos: 7 };
  else if (path.endsWith("/vault/preferencias/ordem") || path.includes("/vault/preferencias")) value = { ok: true };
  else if (path.endsWith("/vault/transacoes")) value = { items: txs, next_cursor: null };
  else if (path.endsWith("/vault/recorrencias")) value = [{ id: "r1", descricao: "Aluguel", tipo: "saida", valor_centavos: 240000, frequencia: "mensal", ativa: true, categoria_id: "alu" }];
  else throw new Error(`Ação não configurada nesta fixture: ${metodo} ${path}`);
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
};

function Pagina() {
  const [period, setPeriod] = useState<Period>(() => ({ kind: "month", year: 2026, month: 9 }));
  const [lista, setLista] = useState<Cat[]>(categorias);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  return (
    <div className="cofre-app cofre-embedded">
      <div className="cofre-workspace">
        <aside className="cofre-nav" />
        <main className="cofre-main">
          <div className="cofre-content">
            <div role="dialog" aria-label="Editar lançamento (fixture)" style={{ position: "fixed", zIndex: 80, top: 60, left: "50%", marginLeft: -230, width: 460, height: 640, borderRadius: 18, border: "1px solid var(--border)", background: "var(--panel)", padding: 20 }} className="cofre-launch-form"><CampoCategoria categorias={lista as never} valor={escolhida} onChange={setEscolhida} /></div>
            <VaultCategories period={period} onPeriodChange={setPeriod} categorias={lista as never} atualizar={() => setLista([...categorias])} />
          </div>
        </main>
      </div>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(<Pagina />);
