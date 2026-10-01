import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import * as Icons from "lucide-react";
import { Search, X } from "lucide-react";
import { CATEGORIAS_LUCIDE, ICONES_LUCIDE } from "./nexus/lucide-catalogo";

const ROTULOS: Record<string, string> = {
  text: "Texto", design: "Design", accessibility: "Acessibilidade", medical: "Saúde", account: "Conta", social: "Social", science: "Ciência", multimedia: "Multimídia", home: "Casa", connectivity: "Conectividade", devices: "Dispositivos", brands: "Marcas", notifications: "Notificações", time: "Tempo", travel: "Viagem", photography: "Fotografia", layout: "Layout", transportation: "Transporte", development: "Desenvolvimento", "food-beverage": "Comida e bebida", gaming: "Jogos", maps: "Mapas", emoji: "Emoji", communication: "Comunicação", buildings: "Construções", tools: "Ferramentas", files: "Arquivos", mail: "E-mail", furniture: "Móveis", arrows: "Setas", navigation: "Navegação", maths: "Matemática", sports: "Esportes", people: "Pessoas", shapes: "Formas", shopping: "Compras", money: "Dinheiro", currency: "Moedas", nature: "Natureza", animals: "Animais", security: "Segurança", charts: "Gráficos", cursors: "Cursores", weather: "Clima", sustainability: "Sustentabilidade", seasons: "Estações",
};
/** Categorias mais úteis para finanças vêm primeiro; o resto segue em ordem alfabética. */
const PRIORIDADE = ["money", "currency", "shopping", "food-beverage", "home", "transportation", "medical", "travel", "gaming", "multimedia", "sports", "people", "animals", "nature", "account", "tools", "buildings", "communication", "devices", "time"];

/** Busca em português: cada termo é expandido para equivalentes em inglês (nomes e tags do Lucide são em inglês). */
const SINONIMOS: Record<string, string[]> = {
  dinheiro: ["money", "cash", "coin", "banknote"], grana: ["money", "cash"], moeda: ["coin", "currency"], moedas: ["coins", "currency"], banco: ["bank", "landmark"], cartao: ["card", "credit"], credito: ["credit", "card"], pagamento: ["payment", "card", "wallet"], carteira: ["wallet"], conta: ["account", "receipt", "wallet"], poupanca: ["piggy", "bank", "savings"], investimento: ["trending", "chart", "investment"], lucro: ["trending", "profit"], salario: ["banknote", "briefcase", "money"], imposto: ["receipt", "landmark", "percent"], desconto: ["percent", "tag", "badge"],
  comida: ["food", "utensils", "pizza", "burger"], mercado: ["shopping", "cart", "store", "basket"], supermercado: ["shopping", "cart", "store"], restaurante: ["utensils", "chef", "restaurant"], cafe: ["coffee", "cup"], bebida: ["beer", "wine", "cup", "glass", "drink"], lanche: ["sandwich", "burger", "cookie"], fruta: ["apple", "cherry", "banana"], padaria: ["croissant", "baguette", "wheat"], doce: ["cake", "candy", "cookie", "ice"], sorvete: ["ice", "cream"],
  casa: ["home", "house"], aluguel: ["home", "house", "key"], moradia: ["home", "house", "building"], luz: ["zap", "lightbulb", "lamp", "bolt"], energia: ["zap", "plug", "bolt", "battery"], agua: ["droplet", "droplets", "water"], gas: ["flame", "fuel"], internet: ["wifi", "globe", "router"], telefone: ["phone", "smartphone"], celular: ["smartphone", "phone"], movel: ["sofa", "armchair", "bed"], moveis: ["sofa", "armchair", "bed", "lamp"], cama: ["bed"], reforma: ["hammer", "paint", "wrench", "construction"], limpeza: ["spray", "brush", "bucket", "sparkles"],
  carro: ["car"], moto: ["bike", "motorcycle", "scooter"], onibus: ["bus"], transporte: ["bus", "train", "car", "truck"], gasolina: ["fuel"], combustivel: ["fuel"], estacionamento: ["parking", "square"], uber: ["car", "taxi"], taxi: ["car", "taxi"], aviao: ["plane"], viagem: ["plane", "luggage", "map", "compass", "tent"], voo: ["plane"], hotel: ["hotel", "bed", "building"], bicicleta: ["bike", "bicycle"], trem: ["train", "tram"], navio: ["ship", "sailboat", "anchor"],
  saude: ["heart", "stethoscope", "pill", "cross", "activity"], remedio: ["pill", "tablets"], farmacia: ["pill", "cross", "tablets"], medico: ["stethoscope", "hospital"], dentista: ["tooth", "dental"], hospital: ["hospital", "cross"], academia: ["dumbbell", "weight", "gym"], esporte: ["trophy", "dumbbell", "football", "ball"], futebol: ["football", "goal"], corrida: ["footprints", "timer", "activity"],
  escola: ["school", "graduation", "book"], curso: ["graduation", "book", "library"], faculdade: ["graduation", "university"], livro: ["book", "library"], estudo: ["book", "graduation", "pencil"],
  filme: ["film", "clapperboard", "popcorn", "tv"], cinema: ["film", "clapperboard", "popcorn"], musica: ["music", "headphones", "guitar"], jogo: ["gamepad", "dice", "puzzle"], jogos: ["gamepad", "dice", "puzzle"], streaming: ["tv", "play", "monitor", "radio"], assinatura: ["repeat", "refresh", "calendar", "tv"], diversao: ["party", "smile", "gamepad", "ticket"], festa: ["party", "cake", "gift", "popper"], presente: ["gift"], show: ["ticket", "music", "mic"], ingresso: ["ticket"],
  roupa: ["shirt", "hanger"], roupas: ["shirt", "hanger"], sapato: ["footprints", "shoe"], beleza: ["sparkles", "scissors", "brush", "palette"], cabelo: ["scissors", "comb"], salao: ["scissors", "brush"], perfume: ["spray", "flask"], compras: ["shopping", "bag", "cart", "store"], loja: ["store", "shopping"], eletronico: ["smartphone", "laptop", "monitor", "cpu"], computador: ["laptop", "monitor", "computer", "cpu"], tecnologia: ["cpu", "laptop", "smartphone", "code"],
  pet: ["paw", "dog", "cat", "bone"], cachorro: ["dog", "paw", "bone"], gato: ["cat", "paw"], animal: ["paw", "dog", "cat", "bird", "fish"], planta: ["flower", "leaf", "sprout", "tree"], jardim: ["flower", "sprout", "tree", "leaf"], crianca: ["baby", "backpack", "toy"], bebe: ["baby"], familia: ["users", "baby", "heart", "home"], filhos: ["baby", "users"],
  trabalho: ["briefcase", "building", "laptop"], empresa: ["building", "briefcase"], escritorio: ["briefcase", "building", "printer"], ferramenta: ["wrench", "hammer", "tools"], servico: ["wrench", "briefcase", "hammer"], conserto: ["wrench", "hammer", "settings"], seguro: ["shield", "umbrella", "lock"], seguranca: ["shield", "lock", "key"], doacao: ["heart", "gift", "hand"], caridade: ["heart", "hand", "gift"], religiao: ["church", "star", "heart"],
  transferencia: ["arrow", "repeat", "refresh", "send"], recorrente: ["repeat", "refresh", "rotate"], parcela: ["calendar", "split", "layers"], emprestimo: ["hand", "landmark", "banknote"], divida: ["alert", "triangle", "banknote"], meta: ["target", "flag", "trophy"], outros: ["more", "ellipsis", "circle", "tag"], diversos: ["more", "ellipsis", "tag", "shapes"], clima: ["cloud", "sun", "rain"], tempo: ["clock", "timer", "hourglass"], data: ["calendar"],
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const rotuloDe = (id: string) => ROTULOS[id] ?? id;

const CATALOGO = ICONES_LUCIDE.map(([nome, cats, tags]) => ({
  nome,
  cats,
  texto: norm(`${nome.replace(/([a-z0-9])([A-Z])/g, "$1 $2")} ${tags}`),
}));
const POR_CATEGORIA = CATEGORIAS_LUCIDE.map((_, i) => CATALOGO.filter((c) => c.cats.includes(i)).length);
const ORDEM = CATEGORIAS_LUCIDE.map((id, i) => ({ id, i })).sort((a, b) => {
  const pa = PRIORIDADE.indexOf(a.id), pb = PRIORIDADE.indexOf(b.id);
  if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  return rotuloDe(a.id).localeCompare(rotuloDe(b.id), "pt-BR");
});
const LOTE = 144;

export default function IconPicker({ value, onChange, cor }: { value: string; onChange: (nome: string) => void; cor: string }) {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<number | null>(null);
  const [limite, setLimite] = useState(LOTE);
  const grade = useRef<HTMLDivElement>(null);
  const termo = useDeferredValue(busca);

  const lista = useMemo(() => {
    const termos = norm(termo).split(/\s+/).filter(Boolean);
    return CATALOGO.filter((ic) => {
      if (categoria !== null && !ic.cats.includes(categoria)) return false;
      return termos.every((t) => ic.texto.includes(t) || (SINONIMOS[t] ?? []).some((s) => ic.texto.includes(s)));
    });
  }, [termo, categoria]);

  useEffect(() => { setLimite(LOTE); grade.current?.scrollTo({ top: 0 }); }, [termo, categoria]);

  const mapa = Icons as unknown as Record<string, Icons.LucideIcon>;
  const visiveis = lista.slice(0, limite);

  return (
    <div className="cofre-iconpicker">
      <label className="cofre-cats-search">
        <Search size={13} />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={`Buscar entre ${CATALOGO.length} ícones… (ex.: mercado, carro, saúde)`} aria-label="Buscar ícone" />
        {busca && <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")}><X size={12} /></button>}
      </label>
      <div className="cofre-iconpicker-cats" role="tablist" aria-label="Categorias de ícones">
        <button type="button" role="tab" aria-selected={categoria === null} onClick={() => setCategoria(null)}>Todos<small>{CATALOGO.length}</small></button>
        {ORDEM.map(({ id, i }) => (
          <button key={id} type="button" role="tab" aria-selected={categoria === i} onClick={() => setCategoria(i)}>{rotuloDe(id)}<small>{POR_CATEGORIA[i]}</small></button>
        ))}
      </div>
      <div ref={grade} className="cofre-iconpicker-grid" onScroll={(e) => { const el = e.currentTarget; if (limite < lista.length && el.scrollTop + el.clientHeight > el.scrollHeight - 160) setLimite((l) => l + LOTE); }}>
        {visiveis.map((ic) => {
          const I = mapa[ic.nome];
          if (!I) return null;
          const ativo = value === ic.nome;
          return <button key={ic.nome} type="button" title={ic.nome} aria-label={ic.nome} aria-pressed={ativo} style={ativo ? { background: cor, color: "#0b0b0b" } : undefined} onClick={() => onChange(ic.nome)}><I size={18} /></button>;
        })}
        {lista.length === 0 && <p className="cofre-cats-none">Nenhum ícone encontrado para “{busca}”.</p>}
      </div>
      <small className="cofre-iconpicker-count">{lista.length} ícone{lista.length === 1 ? "" : "s"}{categoria !== null ? ` em ${rotuloDe(CATEGORIAS_LUCIDE[categoria]!)}` : ""}</small>
    </div>
  );
}
