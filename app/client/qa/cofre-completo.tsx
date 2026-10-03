// Fixture de desenvolvimento do Cofre inteiro (menu, painel, transações, contas, categorias, comprovantes).
// Todas as chamadas são interceptadas e os dados são sintéticos: nenhum dado real é acessado.
// Abrir:  /qa/cofre-completo.html#/cofre/lancamentos        (Cofre pessoal)
//         /qa/cofre-completo.html?equipe=1#/cofre/lancamentos (Cofre de equipe: mostra "quem lançou")
import ReactDOM from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../src/lib/auth-context";
import { RefreshProvider } from "../src/lib/refresh-bus";
import { AppUIProvider } from "../src/lib/ui-context";
import { VaultWorkspace } from "../src/screens/Vault/VaultScreen";
import "../src/styles/global.css";

const equipe = new URLSearchParams(location.search).get("equipe") === "1";
try { localStorage.setItem("ecos:espaco-ativo", equipe ? "equipe:eq1" : "pessoal"); } catch { /* sem armazenamento */ }

const categorias = [
  { id: "mercado", nome: "Alimentação", cor: "#86d7ad", tipo: "saida", icone: "ShoppingCart", padrao: false, espaco: "pessoal" },
  { id: "casa", nome: "Moradia", cor: "#93c5fd", tipo: "saida", icone: "House", padrao: true, espaco: "pessoal" },
  { id: "lazer", nome: "Lazer", cor: "#fdba74", tipo: "saida", icone: "Clapperboard", padrao: false, espaco: "pessoal" },
  { id: "saude", nome: "Saúde", cor: "#f9a8d4", tipo: "saida", icone: "HeartPulse", padrao: false, espaco: "pessoal" },
  { id: "renda", nome: "Renda", cor: "#fcd34d", tipo: "entrada", icone: "Wallet", padrao: false, espaco: "pessoal" },
];
let contas = [
  { id: "c1", nome: "Nubank", banco: "Nubank", codigo_banco: "260", agencia: "0001", numero_conta: "1234567-8", cor: "#8a05be", padrao: false, espaco: "pessoal", tipo: "corrente", saldo_inicial_centavos: 250000 },
  { id: "c2", nome: "Itaú — poupança", banco: "Itaú", codigo_banco: "341", agencia: "4321", numero_conta: "55555-0", cor: "#ec7000", padrao: false, espaco: "pessoal", tipo: "poupanca", saldo_inicial_centavos: 1500000 },
  { id: "c3", nome: "Carteira", banco: null, codigo_banco: null, agencia: null, numero_conta: null, cor: "#94a3b8", padrao: false, espaco: "pessoal", tipo: "carteira", saldo_inicial_centavos: 20000 },
];
const prefs: { conta_padrao: string | null; ordem_contas: string[]; ordem_categorias: string[] } = { conta_padrao: null, ordem_contas: [], ordem_categorias: [] };
const pagadores = [{ id: "b1", nome: "Supermercado Bom Preço" }, { id: "b2", nome: "Karine Souza" }, { id: "b3", nome: "Light" }, { id: "b4", nome: "Cinemark" }];
const nomes = ["Mercado", "Aluguel", "Pix para Karine", "Conta de luz", "Cinema", "Farmácia", "Restaurante", "Salário"];
const txs: Record<string, unknown>[] = [];
for (let i = 0; i < 60; i++) {
  const entrada = i % 9 === 8;
  const cat = entrada ? "renda" : categorias[i % 4]!.id;
  txs.push({
    id: `t${i}`, tipo: entrada ? "entrada" : "saida", valor_centavos: entrada ? 450000 : 1500 + ((i * 977) % 38000), moeda: "BRL",
    data: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, descricao: nomes[i % nomes.length] + (i > 7 ? ` ${i}` : ""),
    categoria_id: cat, conta_id: contas[i % 3]!.id, beneficiario_id: i % 5 === 4 ? null : pagadores[i % 4]!.id, forma_pagamento: ["pix", "cartao", "ted", "boleto"][i % 4],
    status: i % 6 === 0 ? "pendente" : "efetivada", observacoes: null, origem: "manual", espaco: "pessoal", criado_por: i % 3 === 0 ? "u2" : "u1",
    criado_em: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T10:${String(i % 60).padStart(2, "0")}:00`, atualizado_em: "", anexos: i % 4 === 0 ? 1 : 0, notas_fiscais: i % 7 === 0 ? 1 : 0,
  });
}
const PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 62>>stream\nBT /F1 24 Tf 40 340 Td (Comprovante PIX) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF";
const painel = {
  saldo: 1987654, receitas: 1800000, despesas: 640000, taxa_economia: 64.4, mensal: false,
  series: Array.from({ length: 30 }, (_, i) => ({ data: `2026-09-${String(i + 1).padStart(2, "0")}`, receitas: i % 9 === 8 ? 450000 + (i % 5) * 20000 : 0, despesas: 5000 + ((i * 977) % 30000) + (i % 6 === 0 ? 20000 : 0), receitas_confirmadas: i % 9 === 8 ? 450000 : 0, despesas_confirmadas: 5000 + ((i * 977) % 30000) })),
  categorias: [{ chave: "mercado", valor: 220000 }, { chave: "casa", valor: 300000 }, { chave: "lazer", valor: 90000 }, { chave: "saude", valor: 30000 }],
  pagamentos: [{ chave: "pix", valor: 400000 }, { chave: "cartao", valor: 240000 }],
  maiores_entradas: [{ id: "t8", descricao: "Salário", valor: 450000, data: "2026-09-09" }], maiores_saidas: [{ id: "t1", descricao: "Aluguel", valor: 120000, data: "2026-09-02" }],
  previsoes: [4, 11, 14, 18, 22, 25, 28].map((d, i) => ({ recorrencia_id: `r${i}`, data: `2026-09-${String(d).padStart(2, "0")}`, tipo: i % 3 === 0 ? "entrada" : "saida", descricao: i % 3 === 0 ? "Freela" : "Assinatura", valor_centavos: i % 3 === 0 ? 350000 : 24000 + i * 9000 })),
};

const json = (valor: unknown, status = 200) => new Response(JSON.stringify(valor), { status, headers: { "content-type": "application/json" } });
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  const path = url.pathname.replace(/^\/api\/v1/, "");
  const metodo = init?.method ?? "GET";
  await new Promise((r) => setTimeout(r, 40));
  if (path === "/me") return json({ id: "u1", nome_usuario: "ana", nome: "Ana Souza", cofre_ativado: true, avatar_atualizado_em: null, equipes: equipe ? [{ id: "eq1", nome: "CRBS", cargo: "admin" }] : [], papel: "usuario", deve_trocar_senha: false, termos_pendente: false, termos_versao: "1" });
  if (path === "/equipes") return json(equipe ? [{ id: "eq1", nome: "CRBS", cargo: "admin", tipo: "time", membros: 2 }] : []);
  if (path === "/equipes/eq1/membros") return json([{ usuario_id: "u1", cargo: "admin", nome: "Ana Souza" }, { usuario_id: "u2", cargo: "membro", nome: "Bruno Lima" }]);
  if (path.startsWith("/usuarios/")) return new Response("", { status: 404 });
  if (path === "/vault/config") return json({ cofre_ativado: true, destrancado: true, saldos_por_conta: contas.map((c) => ({ conta_id: c.id, nome: c.nome, saldo_centavos: c.saldo_inicial_centavos })) });
  if (path === "/vault/categorias") return json([...categorias].sort((a, b) => (prefs.ordem_categorias.indexOf(a.id) + 99) % 99 - (prefs.ordem_categorias.indexOf(b.id) + 99) % 99));
  if (path === "/vault/contas") return json(contas);
  if (path === "/vault/preferencias" && metodo === "GET") return json(prefs);
  if (path.startsWith("/vault/preferencias/") && metodo === "PUT") {
    const chave = path.split("/").pop()!;
    const { valor } = JSON.parse(String(init?.body));
    (prefs as Record<string, unknown>)[chave] = valor;
    if (chave === "ordem_contas") contas = [...contas].sort((a, b) => valor.indexOf(a.id) - valor.indexOf(b.id));
    if (chave === "conta_padrao") contas = contas.map((c) => ({ ...c, padrao: c.id === valor }));
    return json({ ok: true });
  }
  if (path === "/vault/beneficiarios") return json(pagadores.map((p) => ({ ...p, documento: null, observacoes: null })));
  if (path === "/vault/transacoes") return json({ items: txs, next_cursor: null });
  if (/^\/vault\/transacoes\/[^/]+\/anexos$/.test(path)) {
    const id = path.split("/")[3]!;
    const t = txs.find((x) => x.id === id) as { anexos: number; notas_fiscais: number } | undefined;
    return json([...(t && t.anexos ? [{ id: "ac", nome_arquivo: "pix.pdf", mime_type: "application/pdf", tamanho_bytes: 900, checksum_sha256: "h", criado_em: "", tipo: "comprovante" }] : []), ...(t && t.notas_fiscais ? [{ id: "an", nome_arquivo: "nota.pdf", mime_type: "application/pdf", tamanho_bytes: 900, checksum_sha256: "h2", criado_em: "", tipo: "nota_fiscal" }] : [])]);
  }
  if (/^\/vault\/anexos\/[^/]+\/conteudo$/.test(path)) return new Response(PDF, { headers: { "content-type": "application/pdf" } });
  if (/^\/vault\/anexos\/[^/]+\/miniatura$/.test(path)) return new Response("", { status: 404 });
  if (path.startsWith("/vault/transacoes/")) { const t = txs.find((x) => x.id === path.split("/")[3]); return t ? json(t) : json({}, 404); }
  if (path === "/vault/busca") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    return json({ items: txs.filter((t) => String(t.descricao).toLowerCase().includes(q.slice(0, 4))).map((t) => ({ id: t.id, pontuacao: 1, so_no_anexo: false })) });
  }
  if (path === "/vault/painel") return json(painel);
  if (path === "/vault/comprovantes") return json({ items: txs.filter((t) => t.anexos).slice(0, 8).map((t) => ({ id: "ac", tipo: "comprovante", nome_arquivo: "pix.pdf", mime_type: "application/pdf", tamanho_bytes: 900, criado_em: "", transacao: { id: t.id, data: t.data, descricao: t.descricao, tipo: t.tipo, valor_centavos: t.valor_centavos, categoria_id: t.categoria_id, beneficiario_id: t.beneficiario_id, conta_id: t.conta_id } })) });
  if (path === "/vault/comprovantes/rascunhos") return json({ items: [] });
  if (path === "/vault/recorrencias") return json([]);
  if (path === "/vault/pendencias") return json([]);
  if (path === "/vault/fluxo/ocorrencias") return json([]);
  return json({});
};

const inicial = location.hash.replace(/^#/, "") || "/cofre/lancamentos";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={[inicial]}>
    <AuthProvider><RefreshProvider><AppUIProvider>
      <div className="cofre-app cofre-embedded" style={{ height: "100vh" }}>
        <Routes><Route path="/cofre/*" element={<VaultWorkspace />} /></Routes>
      </div>
    </AppUIProvider></RefreshProvider></AuthProvider>
  </MemoryRouter>,
);
