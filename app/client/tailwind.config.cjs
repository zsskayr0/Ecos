/**
 * Ecos theme — maps directly to the CSS tokens in
 * `src/styles/tokens.css` (brand architecture, section 1.3).
 * Never declare a new color here outside that table — if a shade is
 * missing, that's a spec gap, not a style decision.
 *
 * `withOpacity` uses the `--x-rgb` variable (an "R G B" triplet) instead
 * of the raw hex — that's what lets `bg-cyan/10`, `border-violet/25` etc.
 * work with opacity even though the color comes from a CSS custom
 * property (needed for the dark/light theme to switch at runtime).
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
        surface: { raised: withOpacity("--ecos-surface-raised-rgb") },
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
