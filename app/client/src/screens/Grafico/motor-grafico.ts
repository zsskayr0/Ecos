import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type ForceLink, type ForceManyBody, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";

import type { ArestaGrafico, NoGrafico } from "@/lib/api";
import { corDoTipo, type PreferenciasGrafico } from "@/lib/preferencias-grafico";

/**
 * Motor do Gráfico: física (d3-force, passo a passo no nosso próprio laço) + desenho em canvas.
 *
 * Tudo que o olho vê é animado por interpolação com tempo (independente da taxa de quadros):
 * aparecer, sumir, destacar, esmaecer, zoom, câmera, dica. Nada muda de uma vez — por isso o hover
 * não pisca: o destaque só começa depois de o mouse "assentar" no nó, o nó segurado fica quase parado
 * e a saída tem tolerância antes de soltar o destaque.
 */

export interface InfoNoHover { no: NoGrafico; grau: number }
export interface CallbacksMotor {
  onAbrir(no: NoGrafico): void;
  onHover(info: InfoNoHover | null): void;
}

interface NoMotor extends SimulationNodeDatum {
  dado: NoGrafico;
  id: string;
  grau: number;
  chave: string;
  casa: boolean;
  /** Presença (0 some, 1 visível) e para onde ela vai. */
  vis: number;
  visAlvo: number;
  /** Relevância: 1 em destaque, perto de 0 esmaecido (hover/busca). */
  rel: number;
  hv: number;
  viz: number;
  rot: number;
  nasc: number;
  inicio: number;
  fase: number;
  freq: number;
  dx: number;
  dy: number;
  px: number;
  py: number;
  raio: number;
  larg: number;
  largFs: number;
}

interface ArestaMotor extends SimulationLinkDatum<NoMotor> {
  dado: ArestaGrafico;
  s: NoMotor;
  t: NoMotor;
  rel: number;
  hl: number;
}

interface Camera { x: number; y: number; k: number }

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const suave = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const ESPERA_DESTAQUE_MS = 70;
const TOLERANCIA_SAIDA_MS = 150;

interface TemaCanvas { texto: string; fundo: string; escuro: boolean; fonte: string }

function lerTema(el: HTMLElement): TemaCanvas {
  const estilo = getComputedStyle(el);
  const texto = estilo.color || "rgb(220,225,235)";
  let fundo = "";
  for (let atual: HTMLElement | null = el; atual && !fundo; atual = atual.parentElement) {
    const c = getComputedStyle(atual).backgroundColor;
    if (c && c !== "transparent" && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(c)) fundo = c;
  }
  const m = texto.match(/\d+(\.\d+)?/g)?.map(Number) ?? [220, 225, 235];
  const escuro = (m[0] * 0.299 + m[1] * 0.587 + m[2] * 0.114) > 140;
  return { texto, fundo: fundo || (escuro ? "rgb(18,19,22)" : "rgb(255,255,255)"), escuro, fonte: estilo.fontFamily || "sans-serif" };
}

export class MotorGrafico {
  private ctx: CanvasRenderingContext2D;
  private nos: NoMotor[] = [];
  private arestas: ArestaMotor[] = [];
  private porId = new Map<string, NoMotor>();
  private naFisica = new Set<NoMotor>();
  private dt = 0.016;
  private vizinhos = new Map<string, Set<string>>();
  private sim: Simulation<NoMotor, ArestaMotor>;
  private forcaLink: ForceLink<NoMotor, ArestaMotor>;
  private forcaCarga: ForceManyBody<NoMotor>;
  private forcaX = forceX<NoMotor>(0);
  private forcaY = forceY<NoMotor>(0);
  private prefs: PreferenciasGrafico;
  private tema: TemaCanvas;
  private quadroTema = 0;
  private busca = "";

  private largura = 0;
  private altura = 0;
  private cam: Camera = { x: 0, y: 0, k: 1 };
  private alvo: Camera = { x: 0, y: 0, k: 1 };
  private raf = 0;
  private ultimo = 0;
  private criadoEm = performance.now();
  private autoAjusteAte = 0;
  private proximoAjuste = 0;
  private usuarioMexeu = false;
  private precisaSincronizar = false;

  private mx = 0;
  private my = 0;
  private dentro = false;
  private hoverId: string | null = null;
  private hoverDesde = 0;
  private saiuEm = 0;
  private arrastando: NoMotor | null = null;
  private panning = false;
  private moveu = false;
  private inicioPonteiro = { x: 0, y: 0 };
  private velPan = { x: 0, y: 0 };
  private cursor = "";

  private dicaX = 0;
  private dicaY = 0;
  private dicaOp = 0;
  private dicaInicializada = false;

  private limpezas: (() => void)[] = [];

  constructor(
    private container: HTMLElement,
    private canvas: HTMLCanvasElement,
    private dica: HTMLElement,
    private cb: CallbacksMotor,
    prefs: PreferenciasGrafico,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D indisponível");
    this.ctx = ctx;
    this.prefs = prefs;
    this.tema = lerTema(container);
    this.forcaLink = forceLink<NoMotor, ArestaMotor>([]).id((n) => n.id).strength(0.5);
    this.forcaCarga = forceManyBody<NoMotor>().distanceMax(360);
    this.sim = forceSimulation<NoMotor>([])
      .force("link", this.forcaLink)
      .force("carga", this.forcaCarga)
      .force("colisao", forceCollide<NoMotor>().radius((n) => n.raio * this.prefs.tamanhoNos + 4).strength(0.8))
      .force("x", this.forcaX)
      .force("y", this.forcaY)
      .alphaDecay(0.022)
      .velocityDecay(0.34)
      .stop();
    this.aplicarForcas(false);
    this.ligarEventos();
    this.autoAjusteAte = this.criadoEm + 3200;
    this.raf = requestAnimationFrame(this.quadro);
  }

  /* ---------- API ---------- */

  definirDados(nos: NoGrafico[], arestas: ArestaGrafico[]) {
    const agora = performance.now();
    const antigos = this.porId;
    const novos: NoMotor[] = [];
    const porId = new Map<string, NoMotor>();
    nos.forEach((dado, i) => {
      const existente = antigos.get(dado.id);
      if (existente) {
        existente.dado = dado;
        existente.chave = normalizar(dado.titulo);
        existente.larg = 0;
        novos.push(existente);
        porId.set(dado.id, existente);
        return;
      }
      const ang = Math.random() * Math.PI * 2;
      const dist = 12 + Math.random() * 60;
      const no: NoMotor = {
        dado, id: dado.id, grau: 0, chave: normalizar(dado.titulo), casa: true,
        vis: 0, visAlvo: 1, rel: 1, hv: 0, viz: 0, rot: 0, nasc: 0,
        inicio: agora + Math.min(i * 5, 700), fase: Math.random() * Math.PI * 2, freq: 0.45 + Math.random() * 0.5,
        dx: 0, dy: 0, px: 0, py: 0, raio: 4, larg: 0, largFs: 0,
        x: Math.cos(ang) * dist, y: Math.sin(ang) * dist,
      };
      no.px = no.x!;
      no.py = no.y!;
      novos.push(no);
      porId.set(dado.id, no);
    });
    this.nos = novos;
    this.porId = porId;

    const reaproveitar = new Map(this.arestas.map((a) => [`${a.dado.origem}→${a.dado.destino}→${a.dado.tipo}`, a]));
    this.arestas = [];
    this.vizinhos = new Map();
    for (const dado of arestas) {
      const s = porId.get(dado.origem);
      const t = porId.get(dado.destino);
      if (!s || !t) continue;
      const chave = `${dado.origem}→${dado.destino}→${dado.tipo}`;
      const antiga = reaproveitar.get(chave);
      this.arestas.push({ dado, source: s, target: t, s, t, rel: antiga?.rel ?? 1, hl: antiga?.hl ?? 0 });
      if (!this.vizinhos.has(s.id)) this.vizinhos.set(s.id, new Set());
      if (!this.vizinhos.has(t.id)) this.vizinhos.set(t.id, new Set());
      this.vizinhos.get(s.id)!.add(t.id);
      this.vizinhos.get(t.id)!.add(s.id);
    }
    for (const n of this.nos) {
      n.grau = this.vizinhos.get(n.id)?.size ?? 0;
      n.raio = (n.dado.tipo === "tag" ? 3 : 4) + Math.min(10, Math.sqrt(n.grau) * 2.2);
    }
    if (this.hoverId && !porId.has(this.hoverId)) this.trocarHover(null);
    this.aplicarBusca();
    this.precisaSincronizar = true;
  }

  definirPrefs(prefs: PreferenciasGrafico) {
    const mudouFisica = prefs.repulsao !== this.prefs.repulsao || prefs.distancia !== this.prefs.distancia || prefs.gravidade !== this.prefs.gravidade || prefs.tamanhoNos !== this.prefs.tamanhoNos;
    const mudouFiltro = prefs.mostrarSemConexao !== this.prefs.mostrarSemConexao || (Object.keys(prefs.tipos) as (keyof typeof prefs.tipos)[]).some((t) => prefs.tipos[t] !== this.prefs.tipos[t]);
    this.prefs = prefs;
    if (mudouFisica) this.aplicarForcas(true);
    if (mudouFiltro) this.precisaSincronizar = true;
  }

  definirBusca(texto: string) {
    this.busca = normalizar(texto.trim());
    this.aplicarBusca();
  }

  /** Enquadra todo o grafo visível com um deslize suave da câmera. */
  ajustar() {
    const visiveis = this.nos.filter((n) => n.visAlvo > 0 && n.x != null);
    if (!visiveis.length || !this.largura) return;
    // Ignora os poucos nós soltos lá longe (2% de cada ponta) para o enquadramento não encolher o grafo por causa deles.
    const xs = visiveis.map((n) => n.x!).sort((a, b) => a - b);
    const ys = visiveis.map((n) => n.y!).sort((a, b) => a - b);
    const corte = Math.floor(visiveis.length * 0.02);
    const x0 = xs[corte], x1 = xs[xs.length - 1 - corte], y0 = ys[corte], y1 = ys[ys.length - 1 - corte];
    const bw = Math.max(40, x1 - x0);
    const bh = Math.max(40, y1 - y0);
    const k = clamp(Math.min((this.largura - 120) / bw, (this.altura - 120) / bh), 0.15, 1.6);
    this.alvo = { k, x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k };
  }

  destruir() {
    cancelAnimationFrame(this.raf);
    this.sim.stop();
    this.limpezas.forEach((f) => f());
    this.limpezas = [];
  }

  /* ---------- interno: dados e forças ---------- */

  private aplicarBusca() {
    for (const n of this.nos) n.casa = !this.busca || n.chave.includes(this.busca);
  }

  private aplicarForcas(reaquecer: boolean) {
    // Hubs (tag com dezenas de itens) empurram mais e esticam os links: as folhas se abrem em anel em vez de amontoar.
    this.forcaCarga.strength((n) => -this.prefs.repulsao * (1 + 0.22 * Math.sqrt(n.grau)));
    this.forcaLink.distance((a) => this.prefs.distancia + 5 * Math.sqrt(Math.max(a.s.grau, a.t.grau)));
    this.forcaX.strength(this.prefs.gravidade);
    this.forcaY.strength(this.prefs.gravidade);
    if (reaquecer) this.sim.alpha(Math.max(this.sim.alpha(), 0.5));
  }

  /** Decide quem fica visível (filtros) e mantém na física só quem está visível ou ainda sumindo, para o layout fluir em vez de saltar. */
  private sincronizar() {
    const { tipos, mostrarSemConexao } = this.prefs;
    const grauVisivel = new Map<string, number>();
    for (const a of this.arestas) {
      if (tipos[a.s.dado.tipo] && tipos[a.t.dado.tipo]) {
        grauVisivel.set(a.s.id, (grauVisivel.get(a.s.id) ?? 0) + 1);
        grauVisivel.set(a.t.id, (grauVisivel.get(a.t.id) ?? 0) + 1);
      }
    }
    for (const n of this.nos) n.visAlvo = tipos[n.dado.tipo] && (mostrarSemConexao || (grauVisivel.get(n.id) ?? 0) > 0) ? 1 : 0;
    const naFisica = this.nos.filter((n) => n.visAlvo > 0 || n.vis > 0.02);
    this.naFisica = new Set(naFisica);
    const ids = new Set(naFisica.map((n) => n.id));
    this.sim.nodes(naFisica);
    this.forcaLink.links(this.arestas.filter((a) => ids.has(a.s.id) && ids.has(a.t.id)));
    this.sim.alpha(Math.max(this.sim.alpha(), 0.45));
    this.precisaSincronizar = false;
  }

  /* ---------- interno: eventos ---------- */

  private ligarEventos() {
    const cv = this.canvas;
    const pos = (e: PointerEvent | WheelEvent | MouseEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    const aoPressionar = (e: PointerEvent) => {
      const p = pos(e);
      this.mx = p.x; this.my = p.y; this.dentro = true;
      this.inicioPonteiro = p;
      this.moveu = false;
      this.usuarioMexeu = true;
      cv.setPointerCapture(e.pointerId);
      const alvo = (this.hoverId && this.porId.get(this.hoverId)) || this.noEm(p.x, p.y);
      if (alvo) {
        this.arrastando = alvo;
        this.trocarHover(alvo);
        const m = this.paraMundo(p.x, p.y);
        alvo.fx = m.x - alvo.dx;
        alvo.fy = m.y - alvo.dy;
        this.sim.alpha(Math.max(this.sim.alpha(), 0.3));
      } else {
        this.panning = true;
        this.velPan = { x: 0, y: 0 };
      }
      this.definirCursor("grabbing");
    };
    const aoMover = (e: PointerEvent) => {
      const p = pos(e);
      const antes = { x: this.mx, y: this.my };
      this.mx = p.x; this.my = p.y; this.dentro = true;
      if (Math.hypot(p.x - this.inicioPonteiro.x, p.y - this.inicioPonteiro.y) > 4) this.moveu = this.moveu || !!(this.arrastando || this.panning);
      if (this.arrastando) {
        const m = this.paraMundo(p.x, p.y);
        this.arrastando.fx = m.x - this.arrastando.dx;
        this.arrastando.fy = m.y - this.arrastando.dy;
        this.sim.alpha(Math.max(this.sim.alpha(), 0.3));
      } else if (this.panning) {
        const dx = p.x - antes.x;
        const dy = p.y - antes.y;
        this.cam.x += dx; this.cam.y += dy; this.alvo.x += dx; this.alvo.y += dy;
        this.velPan = { x: this.velPan.x * 0.6 + dx * 0.4, y: this.velPan.y * 0.6 + dy * 0.4 };
      }
    };
    const aoSoltar = (e: PointerEvent) => {
      try { cv.releasePointerCapture(e.pointerId); } catch { /* captura já liberada */ }
      if (this.arrastando) {
        const no = this.arrastando;
        no.fx = null; no.fy = null;
        this.arrastando = null;
        if (!this.moveu) this.cb.onAbrir(no.dado);
      }
      if (this.panning) {
        this.panning = false;
        // Inércia: a câmera continua deslizando um pouco na direção do arrasto.
        this.alvo.x += this.velPan.x * 7;
        this.alvo.y += this.velPan.y * 7;
      }
      this.definirCursor(this.hoverId ? "pointer" : "grab");
    };
    const aoSair = () => { this.dentro = false; this.saiuEm = performance.now(); };
    const aoEntrar = () => { this.dentro = true; };
    const aoRolar = (e: WheelEvent) => {
      e.preventDefault();
      this.usuarioMexeu = true;
      const p = pos(e);
      const wx = (p.x - this.largura / 2 - this.alvo.x) / this.alvo.k;
      const wy = (p.y - this.altura / 2 - this.alvo.y) / this.alvo.k;
      const k = clamp(this.alvo.k * Math.exp(-e.deltaY * 0.0014), 0.12, 5);
      this.alvo = { k, x: p.x - this.largura / 2 - wx * k, y: p.y - this.altura / 2 - wy * k };
    };
    const aoDuploClique = (e: MouseEvent) => {
      const p = pos(e);
      if (!this.noEm(p.x, p.y)) { this.usuarioMexeu = true; this.ajustar(); }
    };

    cv.addEventListener("pointerdown", aoPressionar);
    cv.addEventListener("pointermove", aoMover);
    cv.addEventListener("pointerup", aoSoltar);
    cv.addEventListener("pointercancel", aoSoltar);
    cv.addEventListener("pointerleave", aoSair);
    cv.addEventListener("pointerenter", aoEntrar);
    cv.addEventListener("wheel", aoRolar, { passive: false });
    cv.addEventListener("dblclick", aoDuploClique);
    const obs = new ResizeObserver(() => this.ajustarTamanho());
    obs.observe(this.container);
    this.ajustarTamanho();
    this.definirCursor("grab");
    this.limpezas.push(() => {
      cv.removeEventListener("pointerdown", aoPressionar);
      cv.removeEventListener("pointermove", aoMover);
      cv.removeEventListener("pointerup", aoSoltar);
      cv.removeEventListener("pointercancel", aoSoltar);
      cv.removeEventListener("pointerleave", aoSair);
      cv.removeEventListener("pointerenter", aoEntrar);
      cv.removeEventListener("wheel", aoRolar);
      cv.removeEventListener("dblclick", aoDuploClique);
      obs.disconnect();
    });
  }

  private ajustarTamanho() {
    const dpr = window.devicePixelRatio || 1;
    this.largura = this.container.clientWidth;
    this.altura = this.container.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(this.largura * dpr));
    this.canvas.height = Math.max(1, Math.floor(this.altura * dpr));
    this.canvas.style.width = `${this.largura}px`;
    this.canvas.style.height = `${this.altura}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private definirCursor(c: string) {
    if (c === this.cursor) return;
    this.cursor = c;
    this.canvas.style.cursor = c;
  }

  private paraMundo(px: number, py: number) {
    return { x: (px - this.largura / 2 - this.cam.x) / this.cam.k, y: (py - this.altura / 2 - this.cam.y) / this.cam.k };
  }

  /** Nó mais próximo do ponteiro, medido onde o nó é desenhado (com a deriva), com folga pequena para acertar com facilidade. */
  private noEm(px: number, py: number): NoMotor | null {
    const m = this.paraMundo(px, py);
    let melhor: NoMotor | null = null;
    let folga = Infinity;
    for (const n of this.nos) {
      if (n.vis < 0.4 || n.visAlvo === 0) continue;
      const r = n.raio * this.prefs.tamanhoNos * (1 + 0.35 * n.hv) + 5 / this.cam.k;
      const sobra = Math.hypot(n.px - m.x, n.py - m.y) - r;
      if (sobra <= 0 && sobra < folga) { melhor = n; folga = sobra; }
    }
    return melhor;
  }

  private trocarHover(no: NoMotor | null, agora = performance.now()) {
    const id = no?.id ?? null;
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.hoverDesde = agora;
    this.cb.onHover(no ? { no: no.dado, grau: no.grau } : null);
    if (!this.arrastando && !this.panning) this.definirCursor(no ? "pointer" : "grab");
  }

  /** Histerese do hover: o nó atual só é solto quando o mouse sai de uma área maior que a de acerto, e só depois de uma pausa. */
  private resolverHover(agora: number) {
    if (this.arrastando || this.panning) return;
    const atual = this.hoverId ? this.porId.get(this.hoverId) ?? null : null;
    if (!this.dentro) {
      if (atual && agora - this.saiuEm > TOLERANCIA_SAIDA_MS) this.trocarHover(null, agora);
      return;
    }
    if (atual) {
      const m = this.paraMundo(this.mx, this.my);
      const r = atual.raio * this.prefs.tamanhoNos * (1 + 0.35 * atual.hv) + 12 / this.cam.k;
      if (atual.visAlvo > 0 && Math.hypot(atual.px - m.x, atual.py - m.y) <= r) { this.saiuEm = agora; return; }
    }
    const candidato = this.noEm(this.mx, this.my);
    if (candidato) { this.trocarHover(candidato, agora); return; }
    if (atual) {
      if (this.saiuEm === 0 || agora - this.saiuEm > TOLERANCIA_SAIDA_MS) this.trocarHover(null, agora);
      else if (this.saiuEm < this.hoverDesde) this.saiuEm = agora;
    }
  }

  /* ---------- laço de animação ---------- */

  private quadro = (t: number) => {
    this.raf = requestAnimationFrame(this.quadro);
    const dt = clamp((t - (this.ultimo || t)) / 1000, 0, 0.05);
    this.ultimo = t;
    this.dt = dt;
    this.atualizar(t, dt);
    this.desenhar(t);
  };

  private atualizar(agora: number, dt: number) {
    const reduzido = document.documentElement.getAttribute("data-reduzir-movimento") === "true";
    const vel = this.prefs.velocidadeAnimacao;
    const k = (tau: number) => (reduzido ? 1 : 1 - Math.exp((-dt * vel) / tau));

    if (++this.quadroTema % 45 === 0) this.tema = lerTema(this.container);
    if (this.precisaSincronizar) this.sincronizar();
    if (this.sim.alpha() > this.sim.alphaMin()) this.sim.tick();

    // Câmera: o zoom e o deslize chegam suaves; durante o carregamento o enquadramento se refaz sozinho.
    if (!this.usuarioMexeu && agora < this.autoAjusteAte && agora >= this.proximoAjuste) { this.ajustar(); this.proximoAjuste = agora + 250; }
    const kc = k(0.14);
    this.cam.x += (this.alvo.x - this.cam.x) * kc;
    this.cam.y += (this.alvo.y - this.cam.y) * kc;
    this.cam.k += (this.alvo.k - this.cam.k) * kc;

    this.resolverHover(agora);
    const hoverAtivo = this.hoverId && agora - this.hoverDesde > ESPERA_DESTAQUE_MS ? this.hoverId : null;
    const conjunto = hoverAtivo ? this.vizinhos.get(hoverAtivo) ?? null : null;
    const { movimentoOcioso, intensidadeMovimento } = this.prefs;
    const segundos = agora / 1000;
    const deriva = !reduzido && movimentoOcioso ? intensidadeMovimento : 0;

    for (const n of this.nos) {
      n.vis += (n.visAlvo - n.vis) * k(0.3);
      if (n.visAlvo === 0 && n.vis < 0.003) n.vis = 0;
      n.nasc = reduzido ? 1 : suave((agora - n.inicio) / 520);

      let alvoRel = 1;
      if (hoverAtivo && n.id !== hoverAtivo && !conjunto?.has(n.id)) alvoRel = 0.1;
      if (this.busca && !n.casa) alvoRel = Math.min(alvoRel, 0.12);
      n.rel += (alvoRel - n.rel) * k(alvoRel < n.rel ? 0.16 : 0.34);
      n.hv += ((n.id === this.hoverId ? 1 : 0) - n.hv) * k(0.14);
      const relacionado = hoverAtivo && (n.id === hoverAtivo || conjunto?.has(n.id)) ? 1 : 0;
      n.viz += (relacionado - n.viz) * k(0.18);

      // O nó sob o mouse (e o que está sendo arrastado) quase não deriva: é isso que mantém o hover firme.
      const amp = deriva * (1.3 + n.raio * 0.1) * (1 - 0.85 * n.hv) * (this.arrastando === n ? 0 : 1);
      const alvoDx = amp ? Math.sin(segundos * n.freq + n.fase) * amp + Math.sin(segundos * n.freq * 1.7 + n.fase * 2) * amp * 0.5 : 0;
      const alvoDy = amp ? Math.cos(segundos * n.freq * 0.9 + n.fase * 1.3) * amp + Math.sin(segundos * n.freq * 1.3 + n.fase) * amp * 0.5 : 0;
      n.dx += (alvoDx - n.dx) * k(0.25);
      n.dy += (alvoDy - n.dy) * k(0.25);
      n.px = (n.x ?? 0) + n.dx;
      n.py = (n.y ?? 0) + n.dy;
    }
    // Quem terminou de sumir sai da física (os nós continuam guardados e voltam com o mesmo lugar).
    if (this.nos.some((n) => n.visAlvo === 0 && n.vis < 0.02 && this.naFisica.has(n))) this.precisaSincronizar = true;

    for (const a of this.arestas) {
      const tocaHover = !!hoverAtivo && (a.s.id === hoverAtivo || a.t.id === hoverAtivo);
      let alvoRel = hoverAtivo ? (tocaHover ? 1 : 0.1) : 1;
      if (this.busca) alvoRel = Math.min(alvoRel, a.s.casa && a.t.casa ? 1 : 0.15);
      a.rel += (alvoRel - a.rel) * k(alvoRel < a.rel ? 0.16 : 0.34);
      a.hl += ((tocaHover ? 1 : 0) - a.hl) * k(0.16);
    }

    this.atualizarDica(dt, reduzido);
  }

  private atualizarDica(dt: number, reduzido: boolean) {
    const no = this.hoverId ? this.porId.get(this.hoverId) ?? null : null;
    const alvoOp = no && this.dentro && !this.arrastando ? 1 : 0;
    this.dicaOp += (alvoOp - this.dicaOp) * (reduzido ? 1 : 1 - Math.exp(-dt / 0.09));
    if (no) {
      let ax = this.mx + 16;
      let ay = this.my + 18;
      if (!this.prefs.dicaSegueMouse) {
        ax = this.largura / 2 + this.cam.x + no.px * this.cam.k + no.raio * this.prefs.tamanhoNos * this.cam.k + 10;
        ay = this.altura / 2 + this.cam.y + no.py * this.cam.k - 14;
      }
      const w = this.dica.offsetWidth;
      const h = this.dica.offsetHeight;
      if (ax + w > this.largura - 8) ax = Math.max(8, (this.prefs.dicaSegueMouse ? this.mx : ax) - w - 16);
      if (ay + h > this.altura - 8) ay = Math.max(8, ay - h - 30);
      if (!this.dicaInicializada) { this.dicaX = ax; this.dicaY = ay; this.dicaInicializada = true; }
      const s = reduzido ? 1 : 1 - Math.exp(-dt / 0.06);
      this.dicaX += (ax - this.dicaX) * s;
      this.dicaY += (ay - this.dicaY) * s;
    } else if (this.dicaOp < 0.01) {
      this.dicaInicializada = false;
    }
    const estilo = this.dica.style;
    estilo.opacity = String(this.dicaOp);
    estilo.transform = `translate3d(${this.dicaX.toFixed(1)}px, ${this.dicaY.toFixed(1)}px, 0) scale(${(0.96 + 0.04 * this.dicaOp).toFixed(3)})`;
    estilo.visibility = this.dicaOp < 0.01 ? "hidden" : "visible";
  }

  /* ---------- desenho ---------- */

  private desenhar(agora: number) {
    const ctx = this.ctx;
    const { cam, prefs, tema } = this;
    ctx.clearRect(0, 0, this.largura, this.altura);
    ctx.save();
    ctx.translate(this.largura / 2 + cam.x, this.altura / 2 + cam.y);
    ctx.scale(cam.k, cam.k);
    ctx.lineCap = "round";
    const reduzido = document.documentElement.getAttribute("data-reduzir-movimento") === "true";
    const hoverNo = this.hoverId ? this.porId.get(this.hoverId) ?? null : null;
    const corDestaque = hoverNo ? corDoTipo(prefs, hoverNo.dado.tipo) : tema.texto;
    const fluxo = reduzido ? 0 : (agora / 1000) * 18;

    // Arestas
    for (const a of this.arestas) {
      const presenca = Math.min(a.s.vis, a.t.vis) * Math.min(a.s.nasc, a.t.nasc);
      if (presenca < 0.01) continue;
      const tipo = a.dado.tipo;
      const base = tipo === "wikilink" ? 0.36 : tipo === "tag" ? 0.17 : 0.28;
      const larg = (prefs.espessuraLinhas * (tipo === "wikilink" ? 1.15 : 0.85)) / cam.k;
      const alfa = base * (0.12 + 0.88 * a.rel) * presenca;
      ctx.beginPath();
      ctx.moveTo(a.s.px, a.s.py);
      ctx.lineTo(a.t.px, a.t.py);
      ctx.globalAlpha = alfa;
      ctx.strokeStyle = tema.texto;
      ctx.lineWidth = larg;
      ctx.setLineDash(tipo === "wikilink" || tipo === "tag" ? [] : [4 / cam.k, 4 / cam.k]);
      ctx.stroke();
      if (a.hl > 0.01) {
        ctx.globalAlpha = Math.min(1, 0.9 * a.hl * presenca);
        ctx.strokeStyle = corDestaque;
        ctx.lineWidth = larg * 1.5;
        ctx.setLineDash([6 / cam.k, 5 / cam.k]);
        ctx.lineDashOffset = -fluxo / cam.k;
        ctx.stroke();
        ctx.lineDashOffset = 0;
      }
      if (prefs.setas && tipo === "wikilink") this.seta(a, alfa + 0.25 * a.hl, a.hl > 0.4 ? corDestaque : tema.texto);
    }
    ctx.setLineDash([]);

    // Nós: primeiro os apagados, por último os em destaque (ficam por cima).
    const ordenados = this.nos.filter((n) => n.vis > 0.01);
    ordenados.sort((p, q) => p.rel + p.hv - (q.rel + q.hv));
    const respiro = reduzido || !prefs.movimentoOcioso ? 0 : 0.045 * prefs.intensidadeMovimento;
    const segundos = agora / 1000;
    for (const n of ordenados) {
      const cor = corDoTipo(prefs, n.dado.tipo);
      const concluida = n.dado.tipo === "tarefa" && n.dado.status === "concluida" && prefs.esmaecerConcluidas;
      const esc = (1 + 0.35 * n.hv + 0.1 * n.viz) * (1 + respiro * Math.sin(segundos * n.freq * 2 + n.fase)) * n.nasc;
      const r = n.raio * prefs.tamanhoNos * esc;
      const presenca = n.vis * n.nasc;
      const opaco = (0.14 + 0.86 * n.rel) * presenca;
      if (r < 0.2) continue;

      if (n.hv > 0.02) {
        // Halo suave do nó sob o mouse.
        ctx.globalAlpha = 0.22 * n.hv * presenca;
        ctx.fillStyle = cor;
        this.forma(n, r + 5 / cam.k);
        ctx.fill();
      }
      ctx.globalAlpha = opaco * (concluida ? 0.55 : 1);
      ctx.fillStyle = cor;
      this.forma(n, r);
      if (concluida) {
        ctx.globalAlpha = opaco * 0.25;
        ctx.fill();
        ctx.globalAlpha = opaco * 0.8;
        ctx.strokeStyle = cor;
        ctx.lineWidth = 1.4 / cam.k;
        ctx.stroke();
      } else {
        ctx.fill();
        // Aro fino na cor do fundo separa nós sobrepostos (como no Linear).
        ctx.globalAlpha = opaco * 0.9;
        ctx.strokeStyle = tema.fundo;
        ctx.lineWidth = 1 / cam.k;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Rótulos: quem disputa o mesmo espaço perde. Entram primeiro o nó sob o mouse, os achados da busca e os mais conectados;
    // quem já estava aparecendo ganha preferência, para o texto não ficar trocando de dono a cada quadro.
    if (prefs.rotulos !== "nunca") {
      const fs = prefs.tamanhoTexto / cam.k;
      ctx.font = `500 ${fs}px ${tema.fonte}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      const candidatos = ordenados.filter((n) => this.rotuloVisivel(n));
      const prioridade = (n: NoMotor) => (n.hv > 0.5 ? 1e7 : 0) + (this.busca && n.casa ? 1e6 : 0) + (n.rot > 0.5 ? 1e3 : 0) + n.viz * 10 + n.grau;
      candidatos.sort((p, q) => prioridade(q) - prioridade(p));
      const aceitos = new Set<NoMotor>();
      const ocupados: number[] = [];
      const altura = fs * 1.25;
      const folga = 3 / cam.k;
      for (const n of candidatos) {
        if (aceitos.size >= 140) break;
        if (n.largFs !== fs || !n.larg) { n.larg = ctx.measureText(this.tituloCurto(n)).width; n.largFs = fs; }
        const x0 = n.px - n.larg / 2 - folga;
        const x1 = n.px + n.larg / 2 + folga;
        const y0 = n.py + n.raio * prefs.tamanhoNos * (1 + 0.35 * n.hv) + 5 / cam.k - folga;
        const y1 = y0 + altura + 2 * folga;
        let livre = true;
        for (let i = 0; i < ocupados.length; i += 4) {
          if (x0 < ocupados[i + 2] && x1 > ocupados[i] && y0 < ocupados[i + 3] && y1 > ocupados[i + 1]) { livre = false; break; }
        }
        if (!livre && n.hv < 0.5) continue;
        ocupados.push(x0, y0, x1, y1);
        aceitos.add(n);
      }
      for (const n of ordenados) {
        n.rot += ((aceitos.has(n) ? 1 : 0) - n.rot) * (reduzido ? 1 : 1 - Math.exp((-this.dt * prefs.velocidadeAnimacao) / 0.2));
        const alfa = n.rot * n.vis * n.nasc * (0.15 + 0.85 * n.rel);
        if (alfa < 0.02) continue;
        const titulo = this.tituloCurto(n);
        const y = n.py + n.raio * prefs.tamanhoNos * (1 + 0.35 * n.hv) + 5 / cam.k;
        ctx.globalAlpha = alfa * 0.9;
        ctx.strokeStyle = tema.fundo;
        ctx.lineWidth = 3.5 / cam.k;
        ctx.strokeText(titulo, n.px, y);
        ctx.globalAlpha = alfa;
        ctx.fillStyle = tema.texto;
        ctx.fillText(titulo, n.px, y);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private tituloCurto(n: NoMotor): string {
    const t = n.dado.titulo;
    return t.length > 30 ? `${t.slice(0, 29)}…` : t;
  }

  private rotuloVisivel(n: NoMotor): boolean {
    const { rotulos } = this.prefs;
    if (rotulos === "nunca") return false;
    if (n.viz > 0.5 || n.hv > 0.5) return true;
    if (this.busca && n.casa) return true;
    if (rotulos === "hover") return false;
    if (rotulos === "sempre") return true;
    // Cada nó ganha rótulo conforme o zoom e o quanto é conectado: afastado, só os centros; aproximado, todos.
    return this.cam.k * (1 + Math.sqrt(n.grau)) >= 4.2;
  }

  /** Evento é losango, os demais são círculos. */
  private forma(n: NoMotor, r: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (n.dado.tipo === "evento") {
      const d = r * 1.2;
      ctx.moveTo(n.px, n.py - d);
      ctx.lineTo(n.px + d, n.py);
      ctx.lineTo(n.px, n.py + d);
      ctx.lineTo(n.px - d, n.py);
      ctx.closePath();
    } else {
      ctx.arc(n.px, n.py, r, 0, Math.PI * 2);
    }
  }

  private seta(a: ArestaMotor, alfa: number, cor: string) {
    const ctx = this.ctx;
    const ang = Math.atan2(a.t.py - a.s.py, a.t.px - a.s.px);
    const r = a.t.raio * this.prefs.tamanhoNos + 2 / this.cam.k;
    const tam = 6 / this.cam.k;
    const x = a.t.px - Math.cos(ang) * r;
    const y = a.t.py - Math.sin(ang) * r;
    ctx.globalAlpha = Math.min(1, alfa);
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(ang - 0.45) * tam, y - Math.sin(ang - 0.45) * tam);
    ctx.lineTo(x - Math.cos(ang + 0.45) * tam, y - Math.sin(ang + 0.45) * tam);
    ctx.closePath();
    ctx.fill();
  }
}
