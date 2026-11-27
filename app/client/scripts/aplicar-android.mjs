// Copia as personalizações do Ecos (src-tauri/android-overrides) por cima do projeto Android gerado (src-tauri/gen).
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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
  ["PushBridge.kt", join(main, "java", "app", "ecos", "client", "PushBridge.kt")],
  ["EcosPushReceiver.kt", join(main, "java", "app", "ecos", "client", "EcosPushReceiver.kt")],
];
for (const [nome, destino] of arquivos) {
  cpSync(join(origem, nome), destino);
  console.log(`aplicado: ${nome}`);
}

// Dependências que o projeto gerado não traz (o build.gradle.kts também é regenerado pelo `tauri android init`).
const gradle = join(raiz, "gen", "android", "app", "build.gradle.kts");
const DEPENDENCIAS = ['implementation("org.unifiedpush.android:connector:2.5.0")'];
let script = readFileSync(gradle, "utf8");
for (const dep of DEPENDENCIAS) {
  if (script.includes(dep)) continue;
  script = script.replace(/dependencies \{\r?\n/, (m) => `${m}    ${dep}\n`);
  console.log(`dependência: ${dep}`);
}
writeFileSync(gradle, script);
