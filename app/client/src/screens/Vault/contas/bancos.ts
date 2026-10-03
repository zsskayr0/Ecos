import type { TipoConta } from "@/lib/api";

/** Banco ou instituição de pagamento do catálogo pré-pronto. `codigo` é o código COMPE (o "número do banco"). */
export interface Banco {
  codigo: string;
  nome: string;
  /** Nome curto, o que aparece na lista. */
  curto: string;
  /** Cor da marca (aproximada), usada como cor padrão da conta. */
  cor: string;
  grupo: "grandes" | "digitais" | "cooperativas" | "regionais" | "investimento" | "financeiras" | "estrangeiros";
}

export const GRUPOS_BANCO: Record<Banco["grupo"], string> = {
  grandes: "Grandes bancos",
  digitais: "Digitais e carteiras",
  cooperativas: "Cooperativas",
  regionais: "Regionais e públicos",
  investimento: "Investimento e outros",
  financeiras: "Financeiras e de marcas",
  estrangeiros: "Bancos estrangeiros",
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
  { codigo: "007", nome: "BNDES", curto: "BNDES", cor: "#005ca9", grupo: "regionais" },
  { codigo: "021", nome: "Banestes", curto: "Banestes", cor: "#0067b1", grupo: "regionais" },
  { codigo: "037", nome: "Banco do Estado do Pará (Banpará)", curto: "Banpará", cor: "#0a7abf", grupo: "regionais" },
  { codigo: "047", nome: "Banco do Estado de Sergipe (Banese)", curto: "Banese", cor: "#1d70b8", grupo: "regionais" },
  { codigo: "082", nome: "Banco Topázio", curto: "Topázio", cor: "#d7282f", grupo: "regionais" },
  { codigo: "254", nome: "Paraná Banco", curto: "Paraná Banco", cor: "#1d4ed8", grupo: "regionais" },
  { codigo: "741", nome: "Banco Ribeirão Preto", curto: "Ribeirão Preto", cor: "#1e3a8a", grupo: "regionais" },
  { codigo: "743", nome: "Banco Semear", curto: "Semear", cor: "#0e7490", grupo: "regionais" },
  { codigo: "612", nome: "Banco Guanabara", curto: "Guanabara", cor: "#0369a1", grupo: "regionais" },
  { codigo: "634", nome: "Banco Triângulo", curto: "Triângulo", cor: "#9d174d", grupo: "regionais" },
  { codigo: "604", nome: "Banco Industrial do Brasil", curto: "Industrial do Brasil", cor: "#1e40af", grupo: "regionais" },
  { codigo: "340", nome: "Super Pagamentos (Superdigital)", curto: "Superdigital", cor: "#e30613", grupo: "digitais" },
  { codigo: "383", nome: "Juno", curto: "Juno", cor: "#ff4f7b", grupo: "digitais" },
  { codigo: "332", nome: "Acesso Soluções de Pagamento", curto: "Acesso Bank", cor: "#0057b8", grupo: "digitais" },
  { codigo: "450", nome: "Fitbank", curto: "Fitbank", cor: "#0ea5e9", grupo: "digitais" },
  { codigo: "462", nome: "Stark Bank", curto: "Stark Bank", cor: "#7c3aed", grupo: "digitais" },
  { codigo: "509", nome: "Celcoin", curto: "Celcoin", cor: "#00c389", grupo: "digitais" },
  { codigo: "510", nome: "Facta Financeira", curto: "Facta", cor: "#e4002b", grupo: "digitais" },
  { codigo: "396", nome: "Hub Pagamentos", curto: "Hub", cor: "#2d6cdf", grupo: "digitais" },
  { codigo: "363", nome: "Singulare", curto: "Singulare", cor: "#0e7490", grupo: "digitais" },
  { codigo: "144", nome: "Bexs Banco de Câmbio", curto: "Bexs", cor: "#0d9488", grupo: "digitais" },
  { codigo: "321", nome: "Crefaz", curto: "Crefaz", cor: "#ef4444", grupo: "digitais" },
  { codigo: "630", nome: "Banco Smartbank", curto: "Smartbank", cor: "#2563eb", grupo: "digitais" },
  { codigo: "613", nome: "Omni Banco", curto: "Omni", cor: "#0369a1", grupo: "digitais" },
  { codigo: "010", nome: "Credicoamo", curto: "Credicoamo", cor: "#0b8f3a", grupo: "cooperativas" },
  { codigo: "114", nome: "Central Cooperativa Esperança (Cecoopes)", curto: "Cecoopes", cor: "#2e8b57", grupo: "cooperativas" },
  { codigo: "246", nome: "Banco ABC Brasil", curto: "ABC Brasil", cor: "#0b3c8a", grupo: "investimento" },
  { codigo: "265", nome: "Banco Fator", curto: "Fator", cor: "#1d4ed8", grupo: "investimento" },
  { codigo: "224", nome: "Banco Fibra", curto: "Fibra", cor: "#334155", grupo: "investimento" },
  { codigo: "184", nome: "Banco Itaú BBA", curto: "Itaú BBA", cor: "#ec7000", grupo: "investimento" },
  { codigo: "107", nome: "Banco Bocom BBM", curto: "Bocom BBM", cor: "#be123c", grupo: "investimento" },
  { codigo: "188", nome: "Ativa Investimentos", curto: "Ativa", cor: "#0f766e", grupo: "investimento" },
  { codigo: "611", nome: "Banco Paulista", curto: "Paulista", cor: "#9a3412", grupo: "investimento" },
  { codigo: "653", nome: "Banco Indusval (Voiter)", curto: "Voiter", cor: "#0f766e", grupo: "investimento" },
  { codigo: "712", nome: "Banco Ourinvest", curto: "Ourinvest", cor: "#b45309", grupo: "investimento" },
  { codigo: "720", nome: "Banco Maxima", curto: "Maxima", cor: "#7c2d12", grupo: "investimento" },
  { codigo: "330", nome: "Banco Bari", curto: "Bari", cor: "#dc2626", grupo: "investimento" },
  { codigo: "412", nome: "Banco Capital", curto: "Capital", cor: "#7e22ce", grupo: "investimento" },
  { codigo: "233", nome: "Banco Cifra", curto: "Cifra", cor: "#475569", grupo: "investimento" },
  { codigo: "320", nome: "Banco CCB Brasil", curto: "CCB Brasil", cor: "#c8102e", grupo: "investimento" },
  { codigo: "479", nome: "Banco ItauBank", curto: "ItauBank", cor: "#ec7000", grupo: "investimento" },
  { codigo: "029", nome: "Banco Itaú Consignado", curto: "Itaú Consignado", cor: "#ec7000", grupo: "financeiras" },
  { codigo: "626", nome: "Banco C6 Consignado", curto: "C6 Consignado", cor: "#4a4a4f", grupo: "financeiras" },
  { codigo: "394", nome: "Banco Bradesco Financiamentos", curto: "Bradesco Financiamentos", cor: "#cc092f", grupo: "financeiras" },
  { codigo: "063", nome: "Banco Bradescard", curto: "Bradescard", cor: "#cc092f", grupo: "financeiras" },
  { codigo: "204", nome: "Banco Bradesco Cartões", curto: "Bradesco Cartões", cor: "#cc092f", grupo: "financeiras" },
  { codigo: "069", nome: "Banco Crefisa", curto: "Crefisa", cor: "#00a859", grupo: "financeiras" },
  { codigo: "120", nome: "Banco Rodobens", curto: "Rodobens", cor: "#dc2626", grupo: "financeiras" },
  { codigo: "610", nome: "Banco VR", curto: "VR", cor: "#00a859", grupo: "financeiras" },
  { codigo: "387", nome: "Banco Toyota do Brasil", curto: "Toyota", cor: "#eb0a1e", grupo: "financeiras" },
  { codigo: "390", nome: "Banco GM", curto: "GM Financial", cor: "#005aa7", grupo: "financeiras" },
  { codigo: "393", nome: "Banco Volkswagen", curto: "Volkswagen", cor: "#001e50", grupo: "financeiras" },
  { codigo: "739", nome: "Banco Cetelem", curto: "Cetelem", cor: "#00a859", grupo: "financeiras" },
  { codigo: "174", nome: "Pernambucanas Financiadora", curto: "Pernambucanas", cor: "#d4145a", grupo: "financeiras" },
  { codigo: "359", nome: "Zema Crédito", curto: "Zema", cor: "#e30613", grupo: "financeiras" },
  { codigo: "411", nome: "Via Certa Financiadora", curto: "Via Certa", cor: "#0369a1", grupo: "financeiras" },
  { codigo: "477", nome: "Citibank N.A.", curto: "Citibank N.A.", cor: "#1b5faa", grupo: "estrangeiros" },
  { codigo: "376", nome: "Banco J.P. Morgan", curto: "J.P. Morgan", cor: "#2f2f2f", grupo: "estrangeiros" },
  { codigo: "370", nome: "Banco Mizuho do Brasil", curto: "Mizuho", cor: "#0b2f7a", grupo: "estrangeiros" },
  { codigo: "456", nome: "Banco MUFG Brasil", curto: "MUFG", cor: "#d4001a", grupo: "estrangeiros" },
  { codigo: "464", nome: "Banco Sumitomo Mitsui Brasileiro", curto: "Sumitomo Mitsui", cor: "#007a3d", grupo: "estrangeiros" },
  { codigo: "487", nome: "Deutsche Bank", curto: "Deutsche Bank", cor: "#0018a8", grupo: "estrangeiros" },
  { codigo: "505", nome: "Banco Credit Suisse (Brasil)", curto: "Credit Suisse", cor: "#003c71", grupo: "estrangeiros" },
  { codigo: "752", nome: "Banco BNP Paribas Brasil", curto: "BNP Paribas", cor: "#00915a", grupo: "estrangeiros" },
  { codigo: "751", nome: "Scotiabank Brasil", curto: "Scotiabank", cor: "#ec111a", grupo: "estrangeiros" },
  { codigo: "755", nome: "Bank of America Merrill Lynch", curto: "Bank of America", cor: "#e31837", grupo: "estrangeiros" },
  { codigo: "757", nome: "Banco KEB Hana do Brasil", curto: "KEB Hana", cor: "#00857c", grupo: "estrangeiros" },
  { codigo: "064", nome: "Goldman Sachs do Brasil", curto: "Goldman Sachs", cor: "#6e9bd1", grupo: "estrangeiros" },
  { codigo: "066", nome: "Banco Morgan Stanley", curto: "Morgan Stanley", cor: "#0b3a6f", grupo: "estrangeiros" },
  { codigo: "017", nome: "BNY Mellon Banco", curto: "BNY Mellon", cor: "#8c1d18", grupo: "estrangeiros" },
  { codigo: "163", nome: "Commerzbank Brasil", curto: "Commerzbank", cor: "#e5b800", grupo: "estrangeiros" },
  { codigo: "065", nome: "Banco AndBank (Brasil)", curto: "AndBank", cor: "#ee2e24", grupo: "estrangeiros" },
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

/** Iniciais para o selo da conta quando o banco não tem logo (o selo usa a cor da marca). */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase();
  return (partes[0]![0]! + partes[1]![0]!).toUpperCase();
}
