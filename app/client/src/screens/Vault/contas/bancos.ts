import type { TipoConta } from "@/lib/api";

/** Banco ou instituição de pagamento do catálogo pré-pronto. `codigo` é o código COMPE (o "número do banco"). */
export interface Banco {
  codigo: string;
  nome: string;
  /** Nome curto, o que aparece na lista. */
  curto: string;
  /** Cor da marca (aproximada), usada como cor padrão da conta. */
  cor: string;
  grupo: "grandes" | "digitais" | "cooperativas" | "regionais" | "investimento";
}

export const GRUPOS_BANCO: Record<Banco["grupo"], string> = {
  grandes: "Grandes bancos",
  digitais: "Digitais e carteiras",
  cooperativas: "Cooperativas",
  regionais: "Regionais e públicos",
  investimento: "Investimento e outros",
};

export const BANCOS: Banco[] = [
  { codigo: "001", nome: "Banco do Brasil", curto: "Banco do Brasil", cor: "#f9d71c", grupo: "grandes" },
  { codigo: "237", nome: "Banco Bradesco", curto: "Bradesco", cor: "#cc092f", grupo: "grandes" },
  { codigo: "341", nome: "Itaú Unibanco", curto: "Itaú", cor: "#ec7000", grupo: "grandes" },
  { codigo: "033", nome: "Banco Santander", curto: "Santander", cor: "#ec0000", grupo: "grandes" },
  { codigo: "104", nome: "Caixa Econômica Federal", curto: "Caixa", cor: "#0a64b4", grupo: "grandes" },
  { codigo: "745", nome: "Banco Citibank", curto: "Citibank", cor: "#1b5faa", grupo: "grandes" },
  { codigo: "422", nome: "Banco Safra", curto: "Safra", cor: "#7a6a3a", grupo: "grandes" },
  { codigo: "399", nome: "Kirton Bank (ex-HSBC)", curto: "Kirton Bank", cor: "#db0011", grupo: "grandes" },

  { codigo: "260", nome: "Nu Pagamentos (Nubank)", curto: "Nubank", cor: "#8a05be", grupo: "digitais" },
  { codigo: "077", nome: "Banco Inter", curto: "Inter", cor: "#ff7a00", grupo: "digitais" },
  { codigo: "336", nome: "Banco C6", curto: "C6 Bank", cor: "#4a4a4f", grupo: "digitais" },
  { codigo: "212", nome: "Banco Original", curto: "Original", cor: "#1fb457", grupo: "digitais" },
  { codigo: "290", nome: "PagBank (PagSeguro)", curto: "PagBank", cor: "#41b883", grupo: "digitais" },
  { codigo: "380", nome: "PicPay", curto: "PicPay", cor: "#21c25e", grupo: "digitais" },
  { codigo: "323", nome: "Mercado Pago", curto: "Mercado Pago", cor: "#2d9cdb", grupo: "digitais" },
  { codigo: "403", nome: "Cora SCD", curto: "Cora", cor: "#fe3e6d", grupo: "digitais" },
  { codigo: "197", nome: "Stone Pagamentos", curto: "Stone", cor: "#00a868", grupo: "digitais" },
  { codigo: "536", nome: "Neon Pagamentos", curto: "Neon", cor: "#00d9d5", grupo: "digitais" },
  { codigo: "280", nome: "Will Financeira (Will Bank)", curto: "Will Bank", cor: "#f4c20d", grupo: "digitais" },
  { codigo: "654", nome: "Banco Digimais (Digio)", curto: "Digio", cor: "#3c63ff", grupo: "digitais" },
  { codigo: "121", nome: "Banco Agibank", curto: "Agibank", cor: "#2fbf71", grupo: "digitais" },
  { codigo: "623", nome: "Banco Pan", curto: "Banco Pan", cor: "#00a7e1", grupo: "digitais" },
  { codigo: "218", nome: "Banco BS2", curto: "BS2", cor: "#5b6cff", grupo: "digitais" },
  { codigo: "637", nome: "Banco Sofisa (Sofisa Direto)", curto: "Sofisa Direto", cor: "#f58220", grupo: "digitais" },
  { codigo: "461", nome: "Asaas IP", curto: "Asaas", cor: "#1e88e5", grupo: "digitais" },
  { codigo: "364", nome: "Efí (Gerencianet)", curto: "Efí", cor: "#f37021", grupo: "digitais" },
  { codigo: "329", nome: "QI Sociedade de Crédito Direto", curto: "QI Tech", cor: "#6c5ce7", grupo: "digitais" },

  { codigo: "756", nome: "Sicoob (Bancoob)", curto: "Sicoob", cor: "#00a77f", grupo: "cooperativas" },
  { codigo: "748", nome: "Sicredi", curto: "Sicredi", cor: "#3fa535", grupo: "cooperativas" },
  { codigo: "136", nome: "Unicred", curto: "Unicred", cor: "#00a859", grupo: "cooperativas" },
  { codigo: "085", nome: "Ailos (Cooperativa Central)", curto: "Ailos", cor: "#0d8fd5", grupo: "cooperativas" },
  { codigo: "133", nome: "Cresol Confederação", curto: "Cresol", cor: "#7ab800", grupo: "cooperativas" },
  { codigo: "097", nome: "Credisis", curto: "Credisis", cor: "#1f6fb5", grupo: "cooperativas" },
  { codigo: "099", nome: "Uniprime Central", curto: "Uniprime", cor: "#c8102e", grupo: "cooperativas" },

  { codigo: "041", nome: "Banco do Estado do Rio Grande do Sul (Banrisul)", curto: "Banrisul", cor: "#0072bc", grupo: "regionais" },
  { codigo: "070", nome: "BRB – Banco de Brasília", curto: "BRB", cor: "#005ca9", grupo: "regionais" },
  { codigo: "004", nome: "Banco do Nordeste do Brasil", curto: "Banco do Nordeste", cor: "#d9232d", grupo: "regionais" },
  { codigo: "003", nome: "Banco da Amazônia", curto: "Banco da Amazônia", cor: "#008d4c", grupo: "regionais" },
  { codigo: "389", nome: "Banco Mercantil do Brasil", curto: "Mercantil do Brasil", cor: "#e30613", grupo: "regionais" },
  { codigo: "318", nome: "Banco BMG", curto: "BMG", cor: "#f26522", grupo: "regionais" },
  { codigo: "707", nome: "Banco Daycoval", curto: "Daycoval", cor: "#00539f", grupo: "regionais" },
  { codigo: "655", nome: "Banco Votorantim (BV)", curto: "BV", cor: "#0033a0", grupo: "regionais" },
  { codigo: "633", nome: "Banco Rendimento", curto: "Rendimento", cor: "#e8742b", grupo: "regionais" },

  { codigo: "208", nome: "Banco BTG Pactual", curto: "BTG Pactual", cor: "#1d3a6f", grupo: "investimento" },
  { codigo: "348", nome: "Banco XP", curto: "XP", cor: "#d8b24c", grupo: "investimento" },
  { codigo: "746", nome: "Banco Modal", curto: "Modal", cor: "#26d07c", grupo: "investimento" },
  { codigo: "243", nome: "Banco Master", curto: "Master", cor: "#6b2fa0", grupo: "investimento" },
  { codigo: "643", nome: "Banco Pine", curto: "Pine", cor: "#0f7a4d", grupo: "investimento" },
  { codigo: "074", nome: "Banco J. Safra", curto: "J. Safra", cor: "#7a6a3a", grupo: "investimento" },
];

export const TIPOS_CONTA: { valor: TipoConta; rotulo: string }[] = [
  { valor: "corrente", rotulo: "Conta corrente" },
  { valor: "poupanca", rotulo: "Poupança" },
  { valor: "investimento", rotulo: "Investimentos" },
  { valor: "cartao", rotulo: "Cartão" },
  { valor: "carteira", rotulo: "Carteira (dinheiro)" },
  { valor: "outro", rotulo: "Outra" },
];

export const ROTULO_TIPO: Record<TipoConta, string> = Object.fromEntries(TIPOS_CONTA.map((t) => [t.valor, t.rotulo])) as Record<TipoConta, string>;

/** Remove acentos e caixa para comparar na busca. */
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Busca por nome ou pelo número do banco ("260", "nu", "itau"). */
export function buscarBancos(termo: string): Banco[] {
  const t = normalizar(termo.trim());
  if (!t) return BANCOS;
  return BANCOS.filter((b) => b.codigo.startsWith(t) || normalizar(b.nome).includes(t) || normalizar(b.curto).includes(t));
}

export function bancoPorCodigo(codigo: string | null | undefined): Banco | undefined {
  return codigo ? BANCOS.find((b) => b.codigo === codigo) : undefined;
}

/** Iniciais para o selo da conta (sem logos de terceiros: o selo usa a cor da marca). */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase();
  return (partes[0]![0]! + partes[1]![0]!).toUpperCase();
}
