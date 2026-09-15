/**
 * Tema do Ecos — mapeia direto pros tokens CSS de
 * `src/styles/tokens.css` (ecos-arquitetura de marca, seção 1.3).
 * Nunca declare uma cor nova aqui fora dessa tabela — se faltar um
 * tom, é lacuna de especificação, não decisão de estilo.
 *
 * `withOpacity` usa a variável `--x-rgb` (triplet "R G B") em vez do hex
 * direto — é o que permite `bg-cyan/10`, `border-violet/25` etc.
 * funcionarem com opacidade mesmo a cor vindo de uma CSS custom property
 * (necessário pro tema dark/light trocar em runtime).
 */
function withOpacity(variavelRgb) {
  return ({ opacityValue }) =>
    opacityValue === undefined ? `rgb(var(${variavelRgb}))` : `rgb(var(${variavelRgb}) / ${opacityValue})`;
}

module.exports = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["\"Space Grotesk\"", "sans-serif"],
        body: ["Inter", "sans-serif"],
        mono: ["\"JetBrains Mono\"", "monospace"],
      },
      colors: {
        base: withOpacity("--ecos-base-rgb"),
        "surface-1": withOpacity("--ecos-surface-1-rgb"),
        "surface-2": withOpacity("--ecos-surface-2-rgb"),
        "surface-3": withOpacity("--ecos-surface-3-rgb"),
        border: withOpacity("--ecos-border-rgb"),
        "text-primary": withOpacity("--ecos-text-primary-rgb"),
        "text-secondary": withOpacity("--ecos-text-secondary-rgb"),
        "text-muted": withOpacity("--ecos-text-muted-rgb"),

        steel: {
          700: withOpacity("--ecos-steel-700-rgb"),
          500: withOpacity("--ecos-steel-500-rgb"),
          400: withOpacity("--ecos-steel-400-rgb"),
          300: withOpacity("--ecos-steel-300-rgb"),
          200: withOpacity("--ecos-steel-200-rgb"),
        },
        cyan: withOpacity("--ecos-cyan-rgb"),
        violet: withOpacity("--ecos-violet-rgb"),

        frescor: withOpacity("--ecos-frescor-rgb"),
        orfa: withOpacity("--ecos-orfa-rgb"),
        interacao: withOpacity("--ecos-interacao-rgb"),
        esquecimento: withOpacity("--ecos-esquecimento-rgb"),

        success: withOpacity("--ecos-success-rgb"),
        warning: withOpacity("--ecos-warning-rgb"),
        error: withOpacity("--ecos-error-rgb"),
        encrypted: withOpacity("--ecos-encrypted-rgb"),
      },
      borderRadius: {
        card: "16px",
        pill: "999px",
      },
      boxShadow: {
        nav: "0 8px 30px rgba(0,0,0,0.35)",
      },
      backdropBlur: {
        nav: "20px",
      },
    },
  },
  plugins: [],
};
