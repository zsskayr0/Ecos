/**
 * Balão de dica no estilo do Ecos no lugar do tooltip nativo do navegador.
 * Qualquer elemento com `title` ganha o balão ao passar o mouse (ou ao receber foco pelo teclado): o `title` sai de
 * cena enquanto o balão está à vista (senão o navegador mostraria o dele junto) e volta quando ele some.
 */
const ATRASO_MS = 450;

export function iniciarDicasEcos(): () => void {
  if (typeof document === "undefined") return () => undefined;
  let balao: HTMLDivElement | null = null;
  let alvo: HTMLElement | null = null;
  let titulo = "";
  let timer: number | undefined;

  const restaurar = () => {
    window.clearTimeout(timer);
    if (alvo && titulo && !alvo.hasAttribute("title")) alvo.setAttribute("title", titulo);
    alvo = null;
    titulo = "";
    balao?.remove();
    balao = null;
  };

  const posicionar = () => {
    if (!balao || !alvo) return;
    const r = alvo.getBoundingClientRect();
    const b = balao.getBoundingClientRect();
    const margem = 8;
    let x = r.left + r.width / 2 - b.width / 2;
    x = Math.max(margem, Math.min(x, window.innerWidth - b.width - margem));
    const abaixo = r.bottom + 8;
    const y = abaixo + b.height + margem > window.innerHeight ? r.top - b.height - 8 : abaixo;
    balao.style.left = `${Math.round(x)}px`;
    balao.style.top = `${Math.round(Math.max(margem, y))}px`;
  };

  const mostrar = () => {
    if (!alvo || !titulo) return;
    balao = document.createElement("div");
    balao.className = "ecos-dica";
    balao.setAttribute("role", "tooltip");
    balao.textContent = titulo;
    document.body.appendChild(balao);
    posicionar();
  };

  const preparar = (el: HTMLElement) => {
    const texto = el.getAttribute("title")?.trim();
    if (!texto) return;
    restaurar();
    alvo = el;
    titulo = texto;
    // Sem nome acessível próprio, o `title` era o nome: mantém como aria-label enquanto ele estiver removido.
    el.removeAttribute("title");
    timer = window.setTimeout(mostrar, ATRASO_MS);
  };

  const aoEntrar = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>("[title]") : null;
    if (t && t !== alvo) preparar(t);
  };
  const aoSair = (e: PointerEvent) => {
    if (alvo && (!(e.relatedTarget instanceof Node) || !alvo.contains(e.relatedTarget))) restaurar();
  };
  const aoFocar = (e: FocusEvent) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>("[title]") : null;
    if (t && t.matches(":focus-visible")) preparar(t);
  };
  const aoDesfocar = () => restaurar();
  const fechar = () => restaurar();

  document.addEventListener("pointerover", aoEntrar, true);
  document.addEventListener("pointerout", aoSair, true);
  document.addEventListener("focusin", aoFocar, true);
  document.addEventListener("focusout", aoDesfocar, true);
  document.addEventListener("pointerdown", fechar, true);
  document.addEventListener("keydown", fechar, true);
  window.addEventListener("scroll", fechar, true);
  window.addEventListener("blur", fechar);
  return () => {
    restaurar();
    document.removeEventListener("pointerover", aoEntrar, true);
    document.removeEventListener("pointerout", aoSair, true);
    document.removeEventListener("focusin", aoFocar, true);
    document.removeEventListener("focusout", aoDesfocar, true);
    document.removeEventListener("pointerdown", fechar, true);
    document.removeEventListener("keydown", fechar, true);
    window.removeEventListener("scroll", fechar, true);
    window.removeEventListener("blur", fechar);
  };
}
