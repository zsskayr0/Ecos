// Copia as personalizações do Ecos (src-tauri/android-overrides) por cima do projeto Android gerado (src-tauri/gen).
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri");
const origem = join(raiz, "android-overrides");
const main = join(raiz, "gen", "android", "app", "src", "main");

if (!existsSync(main)) {
  console.error("Projeto Android não encontrado. Rode `npx tauri android init` primeiro.");
  process.exit(1);
}

const arquivos = [
  ["AndroidManifest.xml", join(main, "AndroidManifest.xml")],
  ["MainActivity.kt", join(main, "java", "app", "ecos", "client", "MainActivity.kt")],
  ["CompartilharBridge.kt", join(main, "java", "app", "ecos", "client", "CompartilharBridge.kt")],
  ["CofreSenhaBridge.kt", join(main, "java", "app", "ecos", "client", "CofreSenhaBridge.kt")],
];
for (const [nome, destino] of arquivos) {
  cpSync(join(origem, nome), destino);
  console.log(`aplicado: ${nome}`);
}
