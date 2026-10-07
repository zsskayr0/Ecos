import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Calculator, Delete, X } from "lucide-react";
import { formatMoeda } from "@/lib/format";

/** O painel entra um pouco por baixo da quina arredondada do formulário, para as duas peças formarem uma superfície só (sem fresta nos cantos). */
const SOBREPOSICAO = 18;
const LIMITE_CENTAVOS = 999_999_999;
const OPERADORES = ["+", "−", "×", "÷"];
const ehOperador = (t: string) => OPERADORES.includes(t);

/** Resolve a expressão digitada (vírgula decimal, + − × ÷ e %), sem `eval`. `null` quando está incompleta ou inválida. */
export function calcular(expressao: string): number | null {
  const fonte = expressao.replace(/\s/g, "").replace(/\./g, "").replace(/,/g, ".").replace(/−/g, "-").replace(/×/g, "*").replace(/÷/g, "/");
  if (!fonte) return null;
  let i = 0;
  const numero = (): number | null => {
    const inicio = i;
    while (i < fonte.length && /[0-9.]/.test(fonte[i])) i++;
    if (i === inicio) return null;
    let valor = Number(fonte.slice(inicio, i));
    if (Number.isNaN(valor)) return null;
    while (fonte[i] === "%") { valor /= 100; i++; }
    return valor;
  };
  const fator = (): number | null => {
    if (fonte[i] === "-") { i++; const v = fator(); return v === null ? null : -v; }
    return numero();
  };
  const termo = (): number | null => {
    let v = fator();
    while (v !== null && (fonte[i] === "*" || fonte[i] === "/")) {
      const op = fonte[i++]; const d = fator();
      if (d === null || (op === "/" && d === 0)) return null;
      v = op === "*" ? v * d : v / d;
    }
    return v;
  };
  let v = termo();
  while (v !== null && (fonte[i] === "+" || fonte[i] === "-")) {
    const op = fonte[i++]; const d = termo();
    if (d === null) return null;
    v = op === "+" ? v + d : v - d;
  }
  return v === null || i !== fonte.length || !Number.isFinite(v) ? null : v;
}

const aTexto = (v: number) => v.toFixed(2).replace(".", ",").replace(/,00$/, "");
const ultimoNumero = (e: string) => e.split(/[+−×÷]/).pop() ?? "";

/** Campo de valor em centavos com uma calculadora que abre a partir de um ícone dentro do próprio campo (aparece ao passar o mouse). */
export function CampoValor({ centavos, aoMudar, autoFocus }: { centavos: number; aoMudar: (centavos: number) => void; autoFocus?: boolean }) {
  const [aberta, setAberta] = useState(false);
  const [fechando, setFechando] = useState(false);
  const [expressao, setExpressao] = useState("");
  const [posicao, setPosicao] = useState<{ top: number; left: number; width: number; height: number; cabeca: number; lado: "direita" | "esquerda" | "baixo" } | null>(null);
  const [pulso, setPulso] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  const resultado = calcular(expressao);
  const temOperacao = /[+−×÷%]/.test(expressao.replace(/^−/, ""));
  const centavosResultado = resultado === null ? null : Math.round(Math.abs(resultado) * 100);
  const valido = centavosResultado !== null && centavosResultado > 0 && centavosResultado <= LIMITE_CENTAVOS;

  function abrir() {
    setExpressao("");
    setFechando(false);
    setAberta(true);
  }
  function fechar() {
    setFechando(true);
    window.setTimeout(() => { setAberta(false); setFechando(false); }, 150);
  }

  // O painel encosta na lateral do formulário (como o painel do lançamento no visor de comprovantes) e acompanha ele se a janela for arrastada.
  useLayoutEffect(() => {
    if (!aberta) return;
    let quadro = 0;
    const medir = () => {
      const alvo = raiz.current?.closest(".cofre-launch-form") ?? raiz.current;
      const r = alvo?.getBoundingClientRect();
      if (r) {
        const largura = Math.round(Math.min(Math.max(r.width, 300), 420)), altura = Math.round(r.height) + 2;
        const lado = r.right + largura + 4 <= window.innerWidth ? "direita" : r.left - largura - 4 >= 0 ? "esquerda" : "baixo";
        // A borda do modal fica 1px fora do formulário: o painel sobe 1px e cresce 2px para as bordas e a linha do cabeçalho coincidirem.
        const top = Math.round(r.top) - 1;
        // Altura do cabeçalho copiada do formulário: a linha divisória das duas peças fica exatamente na mesma altura.
        const cabecalho = alvo?.querySelector(".cofre-launch-header")?.getBoundingClientRect();
        const cabeca = cabecalho ? Math.round(cabecalho.bottom) - top - 1 : 70;
        const proxima = lado === "direita" ? { top, left: Math.round(r.right) - SOBREPOSICAO, width: largura + SOBREPOSICAO, height: altura, cabeca, lado } as const
          : lado === "esquerda" ? { top, left: Math.round(r.left - largura), width: largura + SOBREPOSICAO, height: altura, cabeca, lado } as const
          : { top: Math.max(8, Math.min(top, window.innerHeight - 520)), left: Math.max(8, Math.round(r.right - largura)), width: largura, height: Math.min(altura, 520), cabeca, lado } as const;
        setPosicao((atual) => (atual && atual.top === proxima.top && atual.left === proxima.left && atual.width === proxima.width && atual.height === proxima.height && atual.cabeca === proxima.cabeca && atual.lado === proxima.lado ? atual : proxima));
      }
      quadro = window.requestAnimationFrame(medir);
    };
    medir();
    return () => window.cancelAnimationFrame(quadro);
  }, [aberta]);

  useEffect(() => {
    if (!aberta) return;
    painel.current?.focus();
    const fora = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!painel.current?.contains(n) && !raiz.current?.contains(n)) fechar();
    };
    document.addEventListener("pointerdown", fora);
    return () => { document.removeEventListener("pointerdown", fora); };
  }, [aberta]);

  function digitar(t: string) {
    setExpressao((e) => {
      const ultimo = e.slice(-1);
      if (ehOperador(t)) {
        if (!e) return t === "−" ? "−" : e;
        if (ehOperador(ultimo)) return e.length === 1 ? e : e.slice(0, -1) + t;
        return e + t;
      }
      if (t === "%") return /[0-9]$/.test(e) ? e + t : e;
      const atual = ultimoNumero(e);
      if (t === ",") return atual.includes(",") ? e : e + (/[0-9]$/.test(atual) ? "," : "0,");
      return /,[0-9]{2}$/.test(atual) ? e : e + t;
    });
  }
  function igual() {
    if (resultado === null) return;
    setExpressao(aTexto(Math.abs(resultado)));
    setPulso((p) => p + 1);
  }
  const somaCentavos = valido ? centavos + centavosResultado! : null;
  const somaValida = somaCentavos !== null && somaCentavos <= LIMITE_CENTAVOS && centavos > 0;
  function somar() {
    if (!somaValida) return;
    aoMudar(somaCentavos!);
    fechar();
    raiz.current?.querySelector("input")?.focus();
  }
  function usar() {
    if (!valido) return;
    aoMudar(centavosResultado!);
    fechar();
    raiz.current?.querySelector("input")?.focus();
  }
  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); e.stopPropagation(); fechar(); return; }
    if (k === "Enter") { e.preventDefault(); e.stopPropagation(); if (temOperacao) igual(); else usar(); return; }
    if (k === "=") { e.preventDefault(); igual(); return; }
    if (k === "Backspace") { e.preventDefault(); setExpressao((x) => x.slice(0, -1)); return; }
    if (k === "Delete") { e.preventDefault(); setExpressao(""); return; }
    const mapa: Record<string, string> = { "+": "+", "-": "−", "*": "×", x: "×", "/": "÷", ",": ",", ".": ",", "%": "%" };
    if (/^[0-9]$/.test(k)) { e.preventDefault(); digitar(k); }
    else if (mapa[k]) { e.preventDefault(); digitar(mapa[k]); }
  }

  const teclas: { t: string; tipo?: "op" | "ac" | "igual"; rotulo?: ReactNode; acao?: () => void }[] = [
    { t: "C", tipo: "ac", acao: () => setExpressao("") }, { t: "⌫", tipo: "ac", rotulo: <Delete size={16} />, acao: () => setExpressao((x) => x.slice(0, -1)) }, { t: "%", tipo: "op" }, { t: "÷", tipo: "op" },
    { t: "7" }, { t: "8" }, { t: "9" }, { t: "×", tipo: "op" },
    { t: "4" }, { t: "5" }, { t: "6" }, { t: "−", tipo: "op" },
    { t: "1" }, { t: "2" }, { t: "3" }, { t: "+", tipo: "op" },
    { t: "0" }, { t: "," }, { t: "=", tipo: "igual", acao: igual },
  ];

  return <div className="cofre-valor-wrap" ref={raiz} data-aberta={aberta || undefined}>
    <input autoFocus={autoFocus} inputMode="numeric" value={formatMoeda(centavos)} onChange={(e) => aoMudar(Number(e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9) || 0))} placeholder="R$ 0,00" aria-label="Valor" />
    <button type="button" className="cofre-valor-calc" aria-label="Abrir calculadora" aria-expanded={aberta} title="Calculadora" onClick={() => (aberta ? fechar() : abrir())}><Calculator size={15} /></button>
    {aberta && posicao && createPortal(
      <div className="cofre-calc-lado" data-lado={posicao.lado} style={{ top: posicao.top, left: posicao.left, width: posicao.width, height: posicao.height, "--calc-cabeca": `${posicao.cabeca}px` } as CSSProperties}>
      <div ref={painel} className="cofre-calc" data-fechando={fechando || undefined} role="dialog" aria-label="Calculadora" tabIndex={-1} onKeyDown={aoTeclar}>
        <header className="cofre-calc-cabeca"><div><p>FERRAMENTA</p><h2>Calculadora</h2></div><button type="button" aria-label="Fechar calculadora" onClick={fechar}><X size={16} /></button></header>
        <div className="cofre-calc-corpo">
        <div className="cofre-calc-tela">
          <small className="cofre-calc-atual">{centavos > 0 ? `No campo: ${formatMoeda(centavos)}` : "Campo vazio"}</small>
          <span className="cofre-calc-expressao" title={expressao}>{expressao || "0"}</span>
          <strong key={`${pulso}-${resultado ?? "x"}`} className="cofre-calc-resultado" data-vazio={resultado === null || undefined}>{resultado === null ? "—" : `${temOperacao ? "= " : ""}${formatMoeda(Math.round(Math.abs(resultado) * 100))}`}</strong>
        </div>
        <div className="cofre-calc-teclas">
          {teclas.map((k) => <button key={k.t} type="button" data-tipo={k.tipo} onClick={k.acao ?? (() => digitar(k.t))} aria-label={k.t === "⌫" ? "Apagar" : k.t === "C" ? "Limpar" : k.t}>{k.rotulo ?? k.t}</button>)}
        </div>
        <div className="cofre-calc-acoes">
          <button type="button" className="cofre-calc-usar" disabled={!valido} onClick={usar}>Usar {valido ? formatMoeda(centavosResultado!) : "valor"}</button>
          <button type="button" className="cofre-calc-somar" disabled={!somaValida} onClick={somar} title={centavos > 0 ? `${formatMoeda(centavos)} + ${valido ? formatMoeda(centavosResultado!) : "…"}` : "O campo ainda está vazio"}>Somar {valido ? formatMoeda(centavosResultado!) : "valor"} ao atual{centavos > 0 ? ` (${formatMoeda(centavos)})` : ""}</button>
        </div>
        </div>
      </div></div>, document.body)}
  </div>;
}
