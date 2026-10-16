/// <reference types="vite/client" />

// Cópia CommonJS do lucide: usada só por quem precisa do conjunto inteiro por nome (fica fora do pacote inicial).
declare module "lucide-react/dist/cjs/lucide-react.js" {
  export * from "lucide-react";
}
