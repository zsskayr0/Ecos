/*
 * Define o tema antes da primeira pintura, para não haver flash do tema errado. Espelha `src/lib/theme.ts`:
 * "light" e "dark" valem como salvos; "sistema" (ou nada salvo) segue o sistema operacional.
 * Fica em arquivo próprio porque o CSP do app (`script-src 'self'`) não aceita script inline.
 */
(function () {
  try {
    var salvo = null;
    try { salvo = localStorage.getItem("ecos-tema"); } catch (e) { /* armazenamento indisponível */ }
    var tema = salvo === "light" || salvo === "dark"
      ? salvo
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", tema);
  } catch (e) { /* mantém o data-theme padrão do index.html */ }
})();
