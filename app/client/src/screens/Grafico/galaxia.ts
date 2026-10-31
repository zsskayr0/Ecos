import type { ArestaGrafico, NoGrafico } from "@/lib/api";

/** As duas primeiras partes são o espaço físico e o tipo (Notas/Tarefas). */
export function regiao(no: NoGrafico): { espaco: string; constelacao: string; sistema: string } {
  const partes = (no.caminho ?? "").replace(/\\/g, "/").split("/").filter(Boolean);
  const pastas = no.pasta !== undefined ? (no.pasta ?? "").replace(/\\/g, "/").split("/").filter(Boolean) : partes.slice(2, -1);
  const raiz = no.tipo === "tarefa" ? "Tarefas" : no.tipo === "evento" ? "Eventos" : "Notas";
  return { espaco: no.espaco ?? "pessoal", constelacao: pastas[0] ?? partes[1] ?? raiz, sistema: pastas[1] ?? "Sem subpasta" };
}

export function chaveConstelacao(regiao: { espaco: string; constelacao: string }): string {
  return JSON.stringify([regiao.espaco, regiao.constelacao]);
}

export function pastasVisiveis(nos: NoGrafico[], ids: Set<string>) {
  const galaxias = new Set<string>(), constelacoes = new Set<string>(), sistemas = new Set<string>();
  for (const no of nos) if (ids.has(no.id) && no.tipo !== "tag") {
    const r = regiao(no), chave = chaveConstelacao(r);
    galaxias.add(r.espaco); constelacoes.add(chave); sistemas.add(`${chave}/${r.sistema}`);
  }
  return { galaxias, constelacoes, sistemas };
}

export type FocoGalaxia = { nivel: "universo" | "constelacao" | "sistema" | "planeta"; espaco?: string; constelacao?: string; sistema?: string; id?: string };

/** Seleciona o recorte sem perder as ligações entre sistemas no Universo. */
export function filtrarGalaxia(nos: NoGrafico[], arestas: ArestaGrafico[], foco: FocoGalaxia) {
  const itens = nos.filter((n) => n.tipo !== "tag");
  const vizinhos = new Set<string>([foco.id ?? ""]);
  if (foco.nivel === "planeta") for (const a of arestas) {
    if (a.origem === foco.id) vizinhos.add(a.destino);
    if (a.destino === foco.id) vizinhos.add(a.origem);
  }
  const ids = new Set(itens.filter((n) => {
    if (foco.nivel === "universo") return true;
    const r = regiao(n);
    if (foco.nivel === "planeta") return vizinhos.has(n.id);
    return r.espaco === foco.espaco && r.constelacao === foco.constelacao && (foco.nivel === "constelacao" || r.sistema === foco.sistema);
  }).map((n) => n.id));
  const porId = new Map(nos.map((n) => [n.id, n]));
  const luas: NoGrafico[] = [];
  const ligacoes: ArestaGrafico[] = [];
  for (const a of arestas) {
    if (a.tipo === "tag" && ids.has(a.origem)) {
      const tag = porId.get(a.destino);
      const pai = porId.get(a.origem);
      if (tag && pai) {
        const id = `${tag.id}@${pai.id}`;
        luas.push({ ...tag, id, espaco: pai.espaco, nomeEspaco: pai.nomeEspaco, caminho: pai.caminho, atualizado_em: pai.atualizado_em, tamanho: 0 });
        ligacoes.push({ ...a, destino: id });
      }
    } else if (ids.has(a.origem) && ids.has(a.destino)) ligacoes.push(a);
  }
  return { nos: [...itens.filter((n) => ids.has(n.id)), ...luas], arestas: ligacoes };
}

/** Importância combina recência, conexões e tamanho real do arquivo, sem explodir com notas enormes. */
export function importancia(no: NoGrafico, grau: number, agora = Date.now()): number {
  const data = Date.parse(no.atualizado_em ?? "");
  const dias = Number.isFinite(data) ? Math.max(0, (agora - data) / 86400000) : 365;
  const recente = 1 / (1 + dias / 90);
  const conexoes = Math.min(1, Math.log1p(grau) / Math.log(12));
  const tamanho = Math.min(1, Math.log1p(no.tamanho ?? 0) / Math.log(30000));
  return 0.4 * recente + 0.35 * conexoes + 0.25 * tamanho;
}

export interface CentroOrbital {
  chave: string;
  x: number;
  y: number;
  titulo: string;
  quantidade: number;
  tipo?: "nota" | "tarefa" | "evento";
  pasta?: string;
}

export interface OrbitaNo { centro: string; raioX: number; raioY: number; angulo: number; velocidade: number; rotacao?: number; lua?: boolean; centroNo?: boolean }

export function posicaoOrbital(centro: { x: number; y: number }, orbita: OrbitaNo, tempo: number) {
  const angulo = orbita.angulo + tempo * orbita.velocidade;
  const x = Math.cos(angulo) * orbita.raioX, y = Math.sin(angulo) * orbita.raioY;
  const giro = orbita.rotacao ?? 0;
  return { x: centro.x + x * Math.cos(giro) - y * Math.sin(giro), y: centro.y + x * Math.sin(giro) + y * Math.cos(giro) };
}

/** Preserva o ponto escolhido pelo usuário ao editar uma órbita inclinada. */
export function reancorarOrbita(orbita: OrbitaNo, centro: { x: number; y: number }, ponto: { x: number; y: number }, tempo = 0) {
  const giro = orbita.rotacao ?? 0;
  const dx = ponto.x - centro.x, dy = ponto.y - centro.y;
  const localX = dx * Math.cos(giro) + dy * Math.sin(giro);
  const localY = -dx * Math.sin(giro) + dy * Math.cos(giro);
  const proporcao = orbita.raioX / orbita.raioY;
  orbita.raioY = Math.max(18, Math.hypot(localX / proporcao, localY));
  orbita.raioX = orbita.raioY * proporcao;
  orbita.angulo = Math.atan2(localY / orbita.raioY, localX / orbita.raioX) - tempo * orbita.velocidade;
}

/** Cada componente de links escolhe seu nó mais relevante como centro, sem atravessar pastas. */
export function gruposLigados(itens: NoGrafico[], arestas: ArestaGrafico[], grau: Map<string, number>): NoGrafico[][] {
  const porId = new Map(itens.map((n) => [n.id, n]));
  const pai = new Map(itens.map((n) => [n.id, n.id]));
  const raiz = (id: string): string => { const p = pai.get(id)!; return p === id ? id : raiz(p); };
  for (const a of arestas) if (a.tipo !== "tag" && porId.has(a.origem) && porId.has(a.destino)) {
    const x = raiz(a.origem), y = raiz(a.destino);
    if (x !== y) pai.set(y, x);
  }
  const grupos = new Map<string, NoGrafico[]>();
  for (const n of itens) {
    const id = raiz(n.id);
    if (!grupos.has(id)) grupos.set(id, []);
    grupos.get(id)!.push(n);
  }
  return [...grupos.values()].map((g) => g.sort((a, b) => importancia(b, grau.get(b.id) ?? 0) - importancia(a, grau.get(a.id) ?? 0) || a.id.localeCompare(b.id)));
}

export interface PontoColisao { id: string; x: number; y: number; raio: number; fixo?: boolean }

/** Separa trajetórias que se cruzam, mantendo os astros próximos da própria órbita. */
export function separarColisoes(pontos: PontoColisao[]): void {
  const celula = 64;
  for (let passo = 0; passo < 8; passo++) {
    let houveColisao = false;
    const grade = new Map<string, PontoColisao[]>();
    for (const p of pontos) {
      const gx = Math.floor(p.x / celula), gy = Math.floor(p.y / celula);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const outro of grade.get(`${gx + dx}:${gy + dy}`) ?? []) {
          const minimo = p.raio + outro.raio + 3;
          let vx = p.x - outro.x, vy = p.y - outro.y;
          let distancia = Math.hypot(vx, vy);
          if (distancia >= minimo) continue;
          houveColisao = true;
          if (distancia < 0.001) { vx = p.id < outro.id ? 1 : -1; vy = 0; distancia = 1; }
          const empurrao = (minimo - distancia) / distancia;
          const pesoP = p.fixo ? 0 : outro.fixo ? 1 : 0.5;
          const pesoOutro = outro.fixo ? 0 : p.fixo ? 1 : 0.5;
          p.x += vx * empurrao * pesoP; p.y += vy * empurrao * pesoP;
          outro.x -= vx * empurrao * pesoOutro; outro.y -= vy * empurrao * pesoOutro;
        }
      }
      const chave = `${gx}:${gy}`;
      if (!grade.has(chave)) grade.set(chave, []);
      grade.get(chave)!.push(p);
    }
    if (!houveColisao) break;
  }
}

/** Centros e órbitas são calculados pelos mesmos dados em todos os níveis da navegação. */
export function calcularOrbitas(nos: NoGrafico[], grau: Map<string, number>, foco: FocoGalaxia, arestas: ArestaGrafico[] = []) {
  const planetas = nos.filter((n) => n.tipo !== "tag");
  const posicoes = new Map<string, { x: number; y: number }>();
  const orbitas = new Map<string, OrbitaNo>();
  const galaxias: CentroOrbital[] = [];
  const constelacoes: CentroOrbital[] = [];
  const sistemas: CentroOrbital[] = [];

  if (foco.nivel === "planeta" && foco.id) {
    const principal = planetas.find((n) => n.id === foco.id);
    if (principal) posicoes.set(principal.id, { x: 0, y: 0 });
    const vizinhos = planetas.filter((n) => n.id !== foco.id).sort((a, b) => importancia(b, grau.get(b.id) ?? 0) - importancia(a, grau.get(a.id) ?? 0));
    vizinhos.forEach((n, i) => {
      const ang = -Math.PI / 2 + i * 2.399963;
      const raio = 150 + (1 - importancia(n, grau.get(n.id) ?? 0)) * 130;
      posicoes.set(n.id, { x: Math.cos(ang) * raio * 1.25, y: Math.sin(ang) * raio });
      orbitas.set(n.id, { centro: principal?.id ?? "", raioX: raio * 1.25, raioY: raio, angulo: ang, velocidade: 0.08 + 0.015 * (i % 3) });
    });
  } else {
    const grupos = [...new Set(planetas.map((n) => chaveConstelacao(regiao(n))))].sort();
    const espacos = [...new Set(planetas.map((n) => regiao(n).espaco))].sort();
    espacos.forEach((espaco, i) => {
      const membros = planetas.filter((n) => regiao(n).espaco === espaco);
      const ang = -Math.PI / 2 + i * Math.PI * 2 / Math.max(1, espacos.length);
      const dist = foco.nivel === "universo" && espacos.length > 1 ? 330 : 0;
      galaxias.push({ chave: espaco, x: Math.cos(ang) * dist * 1.35, y: Math.sin(ang) * dist, titulo: membros[0].nomeEspaco ?? (espaco === "pessoal" ? "Pessoal" : "Equipe"), quantidade: membros.length });
    });
    grupos.forEach((grupo) => {
      const membros = planetas.filter((n) => chaveConstelacao(regiao(n)) === grupo);
      const reg = regiao(membros[0]);
      const gal = galaxias.find((g) => g.chave === reg.espaco)!;
      const irmaos = grupos.filter((g) => JSON.parse(g)[0] === reg.espaco);
      const indice = irmaos.indexOf(grupo);
      const ang = -Math.PI / 2 + indice * Math.PI * 2 / Math.max(1, irmaos.length);
      const dist = foco.nivel === "universo" && irmaos.length > 1 ? 160 + Math.max(0, irmaos.length - 5) * 12 : 0;
      const cx = gal.x + Math.cos(ang) * dist * 1.35;
      const cy = gal.y + Math.sin(ang) * dist;
      const rotuloEquipe = membros[0].nomeEspaco ?? "Equipe";
      const tipo = membros[0].tipo === "tarefa" ? "tarefa" : membros[0].tipo === "evento" ? "evento" : "nota";
      const raiz = tipo === "tarefa" ? "Tarefas" : tipo === "evento" ? "Eventos" : "Notas";
      constelacoes.push({ chave: grupo, x: cx, y: cy, titulo: reg.espaco === "pessoal" ? reg.constelacao : `${rotuloEquipe} · ${reg.constelacao}`, quantidade: membros.length, tipo, pasta: reg.constelacao === raiz ? "" : reg.constelacao });
      const subs = [...new Set(membros.map((n) => regiao(n).sistema))].sort();
      subs.forEach((sub, j) => {
        const itens = membros.filter((n) => regiao(n).sistema === sub).sort((a, b) => importancia(b, grau.get(b.id) ?? 0) - importancia(a, grau.get(a.id) ?? 0));
        const angSub = -Math.PI / 2 + j * Math.PI * 2 / Math.max(1, subs.length);
        const distSub = subs.length > 1 ? (foco.nivel === "constelacao" ? 220 : 125) : 0;
        const sx = cx + Math.cos(angSub) * distSub * 1.2;
        const sy = cy + Math.sin(angSub) * distSub;
        sistemas.push({ chave: `${grupo}/${sub}`, x: sx, y: sy, titulo: sub === "Sem subpasta" ? "Sistema principal" : sub, quantidade: itens.length, tipo, pasta: sub === "Sem subpasta" ? (reg.constelacao === raiz ? "" : reg.constelacao) : `${reg.constelacao === raiz ? "" : `${reg.constelacao}/`}${sub}` });
        const componentes = gruposLigados(itens, arestas, grau);
        let soltos = 0, conectados = 0;
        for (const componente of componentes) {
          if (componente.length === 1) {
            const n = componente[0];
            // Cresce com a raiz da população: preenche um disco em vez de comprimir centenas de nós num único anel.
            const raio = 70 + Math.sqrt(soltos) * 50 + (1 - importancia(n, grau.get(n.id) ?? 0)) * 55;
            const angulo = angSub + soltos++ * 2.399963;
            const orbita: OrbitaNo = { centro: `${grupo}/${sub}`, raioX: raio * 1.2, raioY: raio, angulo, rotacao: soltos * 0.61803398875, velocidade: (0.065 + 0.035 / (1 + raio / 300)) * (soltos % 2 ? 1 : -1) };
            orbitas.set(n.id, orbita);
            posicoes.set(n.id, posicaoOrbital({ x: sx, y: sy }, orbita, 0));
            continue;
          }
          const ancora = componente[0];
          const anguloCentro = angSub + conectados * 2.399963;
          const distanciaCentro = 130 + Math.sqrt(conectados) * 95;
          const orbitaCentro: OrbitaNo = { centro: `${grupo}/${sub}`, raioX: distanciaCentro * 1.2, raioY: distanciaCentro, angulo: anguloCentro, velocidade: 0 };
          const pontoCentro = posicaoOrbital({ x: sx, y: sy }, orbitaCentro, 0);
          orbitas.set(ancora.id, orbitaCentro);
          posicoes.set(ancora.id, pontoCentro);
          componente.slice(1).forEach((n, ordem) => {
            const raio = 65 + Math.sqrt(ordem) * 52 + (1 - importancia(n, grau.get(n.id) ?? 0)) * 35;
            const orbita: OrbitaNo = { centro: ancora.id, centroNo: true, raioX: raio * 1.2, raioY: raio, angulo: -Math.PI / 2 + ordem * 2.399963, rotacao: ordem * 0.41, velocidade: (0.09 + 0.03 / (1 + ordem * 0.1)) * (ordem % 2 ? -1 : 1) };
            orbitas.set(n.id, orbita);
            posicoes.set(n.id, posicaoOrbital(pontoCentro, orbita, 0));
          });
          conectados++;
        }
      });
    });
  }

  const luasPorPai = new Map<string, NoGrafico[]>();
  for (const n of nos) if (n.tipo === "tag") {
    const pai = n.id.split("@").at(-1) ?? "";
    if (!luasPorPai.has(pai)) luasPorPai.set(pai, []);
    luasPorPai.get(pai)!.push(n);
  }
  for (const [pai, luas] of luasPorPai) {
    const centro = posicoes.get(pai);
    if (!centro) continue;
    luas.sort((a, b) => a.id.localeCompare(b.id)).forEach((lua, i) => {
      const anel = Math.floor(i / 6);
      const ang = -Math.PI / 2 + (i % 6) * Math.PI * 2 / Math.min(6, luas.length - anel * 6);
      const raio = 45 + anel * 26;
      posicoes.set(lua.id, { x: centro.x + Math.cos(ang) * raio, y: centro.y + Math.sin(ang) * raio });
      orbitas.set(lua.id, { centro: pai, raioX: raio, raioY: raio, angulo: ang, velocidade: 0.35 + anel * 0.05, lua: true });
    });
  }
  return { posicoes, orbitas, galaxias, constelacoes, sistemas };
}
