/*
 * Define o tema antes da primeira pintura, para não haver flash do tema errado. Espelha `src/lib/theme.ts`:
 * "light" e "dark" valem como salvos; "horario" usa a janela salva em "ecos-tema-horario"; "sistema" (ou nada salvo) segue o sistema operacional.
 * Fica em arquivo próprio porque o CSP do app (`script-src 'self'`) não aceita script inline.
 */
(function () {
  try {
    var salvo = null;
    try { salvo = localStorage.getItem("ecos-tema"); } catch (e) { /* armazenamento indisponível */ }
    var tema;
    if (salvo === "horario") {
      var h = { claro: "07:00", escuro: "19:00" };
      try { var x = JSON.parse(localStorage.getItem("ecos-tema-horario") || "null"); if (x && x.claro && x.escuro) h = x; } catch (e) { /* padrão */ }
      var min = function (t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); };
      var d = new Date(), m = d.getHours() * 60 + d.getMinutes(), c = min(h.claro), es = min(h.escuro);
      var claro = c === es ? true : c < es ? (m >= c && m < es) : (m >= c || m < es);
      tema = claro ? "light" : "dark";
    } else tema = salvo === "light" || salvo === "dark"
      ? salvo
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", tema);
  } catch (e) { /* mantém o data-theme padrão do index.html */ }
})();
