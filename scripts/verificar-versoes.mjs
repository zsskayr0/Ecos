// Confere que a versão é a mesma em todos os lugares onde ela vive (Cargo.toml do workspace, Cargo.toml do
// Tauri, package.json e tauri.conf.json). Roda no CI a cada push e, nos releases, também contra a tag:
//   node scripts/verificar-versoes.mjs            -> só confere o conjunto
//   node scripts/verificar-versoes.mjs v0.10.0    -> confere o conjunto e que bate com a tag
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (rel) => readFileSync(join(raiz, rel), "utf8");

const versoes = {
  "Cargo.toml [workspace.package]": ler("Cargo.toml").match(/\[workspace\.package\][^[]*?\nversion\s*=\s*"([^"]+)"/)?.[1],
  "app/client/src-tauri/Cargo.toml": ler("app/client/src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m)?.[1],
  "app/client/package.json": JSON.parse(ler("app/client/package.json")).version,
  "app/client/src-tauri/tauri.conf.json": JSON.parse(ler("app/client/src-tauri/tauri.conf.json")).version,
};

const distintas = new Set(Object.values(versoes));
for (const [onde, v] of Object.entries(versoes)) console.log(`${(v ?? "AUSENTE").padEnd(16)} ${onde}`);
if (distintas.size !== 1 || distintas.has(undefined)) {
  console.error("\nAs versões não coincidem (ver AGENTS.md, 'Diretriz de releases').");
  process.exit(1);
}

const tag = process.argv[2];
if (tag) {
  const esperada = tag.replace(/^v/, "");
  const atual = [...distintas][0];
  if (esperada !== atual) {
    console.error(`\nA tag ${tag} não bate com a versão do código (${atual}).`);
    process.exit(1);
  }
}
