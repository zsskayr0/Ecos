import type { CategoriaApi } from "@/lib/api";
import type { LinhaCategoria } from "./importar";

export interface ModeloCategorias {
  id: string;
  nome: string;
  descricao: string;
  /** Categorias principais com as subcategorias. */
  grupos: { nome: string; tipo: CategoriaApi["tipo"]; icone: string; cor: string; subs: string[] }[];
}

export const MODELOS: ModeloCategorias[] = [
  {
    id: "pessoal",
    nome: "Finanças pessoais",
    descricao: "Casa, mercado, transporte, saúde, lazer e as rendas do dia a dia.",
    grupos: [
      { nome: "Moradia", tipo: "saida", icone: "Home", cor: "#6ec6ff", subs: ["Aluguel", "Condomínio", "Energia elétrica", "Água e esgoto", "Internet e telefone", "Manutenção"] },
      { nome: "Alimentação", tipo: "saida", icone: "Utensils", cor: "#e4636b", subs: ["Mercado", "Restaurantes", "Delivery", "Padaria"] },
      { nome: "Transporte", tipo: "saida", icone: "Car", cor: "#f28fb0", subs: ["Combustível", "Aplicativos", "Transporte público", "Manutenção do veículo", "Seguro e IPVA"] },
      { nome: "Saúde", tipo: "saida", icone: "HeartPulse", cor: "#5eead4", subs: ["Plano de saúde", "Consultas", "Farmácia", "Exames"] },
      { nome: "Educação", tipo: "saida", icone: "GraduationCap", cor: "#a5b4fc", subs: ["Mensalidade", "Cursos", "Material"] },
      { nome: "Lazer", tipo: "saida", icone: "Gamepad2", cor: "#c4b5fd", subs: ["Viagens", "Cinema e eventos", "Assinaturas"] },
      { nome: "Compras", tipo: "saida", icone: "ShoppingBag", cor: "#fdba74", subs: ["Roupas", "Eletrônicos", "Casa"] },
      { nome: "Impostos e taxas", tipo: "saida", icone: "Landmark", cor: "#94a3b8", subs: [] },
      { nome: "Salário", tipo: "entrada", icone: "Briefcase", cor: "#8fd9ac", subs: [] },
      { nome: "Renda extra", tipo: "entrada", icone: "Wallet", cor: "#86d7ad", subs: ["Freelas", "Rendimentos", "Reembolsos"] },
      { nome: "Outros", tipo: "ambos", icone: "MoreHorizontal", cor: "#96969c", subs: [] },
    ],
  },
  {
    id: "empresa",
    nome: "Pequena empresa",
    descricao: "Equipe, fornecedores, impostos, marketing e receitas de clientes.",
    grupos: [
      { nome: "Funcionários", tipo: "saida", icone: "Users", cor: "#f29a9f", subs: ["Salários", "Benefícios", "Encargos sociais", "Férias e 13º", "Rescisões"] },
      { nome: "Fornecedores", tipo: "saida", icone: "Truck", cor: "#fdba74", subs: ["Compra de insumos", "Serviços de terceiros", "Fretes"] },
      { nome: "Impostos", tipo: "saida", icone: "Landmark", cor: "#94a3b8", subs: ["Simples Nacional (DAS)", "ISS", "Taxas e licenças"] },
      { nome: "Estrutura", tipo: "saida", icone: "Building2", cor: "#6ec6ff", subs: ["Aluguel", "Energia e água", "Internet e telefonia", "Material de escritório", "Manutenção"] },
      { nome: "Marketing", tipo: "saida", icone: "Megaphone", cor: "#f0abfc", subs: ["Anúncios", "Brindes", "Eventos"] },
      { nome: "Tecnologia", tipo: "saida", icone: "Laptop", cor: "#a5b4fc", subs: ["Softwares e assinaturas", "Equipamentos"] },
      { nome: "Despesas financeiras", tipo: "saida", icone: "Receipt", cor: "#fcd34d", subs: ["Tarifas bancárias", "Juros", "Empréstimos"] },
      { nome: "Vendas", tipo: "entrada", icone: "ShoppingCart", cor: "#8fd9ac", subs: ["Produtos", "Serviços", "Mensalidades"] },
      { nome: "Outras receitas", tipo: "entrada", icone: "Wallet", cor: "#86d7ad", subs: ["Rendimentos", "Reembolsos"] },
      { nome: "Aportes e retiradas", tipo: "ambos", icone: "ArrowLeftRight", cor: "#96969c", subs: [] },
    ],
  },
  {
    id: "freelancer",
    nome: "Autônomo / freelancer",
    descricao: "Receitas por cliente, ferramentas, impostos e a separação entre vida pessoal e trabalho.",
    grupos: [
      { nome: "Trabalho", tipo: "entrada", icone: "Briefcase", cor: "#8fd9ac", subs: ["Projetos", "Recorrentes", "Consultorias"] },
      { nome: "Ferramentas", tipo: "saida", icone: "Laptop", cor: "#a5b4fc", subs: ["Softwares", "Equipamentos", "Coworking"] },
      { nome: "Impostos e contabilidade", tipo: "saida", icone: "Landmark", cor: "#94a3b8", subs: ["DAS / MEI", "Contador"] },
      { nome: "Divulgação", tipo: "saida", icone: "Megaphone", cor: "#f0abfc", subs: ["Anúncios", "Site e domínio"] },
      { nome: "Vida pessoal", tipo: "saida", icone: "Home", cor: "#6ec6ff", subs: ["Moradia", "Alimentação", "Transporte", "Saúde", "Lazer"] },
      { nome: "Reserva", tipo: "ambos", icone: "PiggyBank", cor: "#5eead4", subs: [] },
    ],
  },
];

/** Linhas prontas para `planejar`: mães primeiro, depois as subcategorias (herdam tipo e cor da mãe). */
export function linhasDoModelo(m: ModeloCategorias): LinhaCategoria[] {
  return m.grupos.flatMap((g) => [
    { nome: g.nome, tipo: g.tipo, icone: g.icone, cor: g.cor },
    ...g.subs.map((s): LinhaCategoria => ({ nome: s, tipo: g.tipo, mae: g.nome, icone: null, cor: g.cor })),
  ]);
}
