#!/usr/bin/env node
// Varre o build final (dist) atrás de dado que não deveria ir ao navegador: segredos reais (valores do .env e o segredo
// de sessão), JWT/chaves privadas/tokens conhecidos, hashes de senha, endereços privados e source maps.
// Uso: npm run build && npm run varrer:dist   (sai com código 1 se achar algo)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliente = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const raiz = resolve(cliente, "../..");
const dist = join(cliente, "dist");
if (!existsSync(dist)) { console.error("dist/ não existe: rode `npm run build` antes."); process.exit(2); }

/** Exemplos de endereço que aparecem só como placeholder/ajuda na tela de conexão com o servidor. */
const EXEMPLOS_PERMITIDOS = ["192.168.0.5"];

function arquivos(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho];
  });
}

/** Valores reais que jamais podem aparecer no bundle: variáveis sensíveis do .env e o segredo de sessão gerado. */
function segredosReais() {
  const valores = new Map();
  const env = join(raiz, ".env");
  if (existsSync(env)) {
    for (const linha of readFileSync(env, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
      const valor = m?.[2].replace(/^["']|["']$/g, "");
      if (m && valor && valor.length >= 8 && /SECRET|TOKEN|PASSWORD|PASS|PRIVATE|KEY/.test(m[1]) && !/_ID$/.test(m[1])) valores.set(`.env ${m[1]}`, valor);
    }
  }
  for (const base of [join(raiz, "ecos-notes"), join(raiz, "..", "ecos-notes"), join(raiz, "data")]) {
    const arq = join(base, ".ecos", "segredo-sessao");
    if (existsSync(arq)) { const v = readFileSync(arq, "utf8").trim(); if (v.length >= 8) valores.set("segredo-sessao", v); }
  }
  return valores;
}

const PADROES = [
  ["JWT", /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ["chave privada", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["hash argon2", /\$argon2[a-z]*\$/g],
  ["campo de hash do banco", /\b(?:senha_hash|recovery_key_hash|refresh_token_hash)\b/g],
  ["token de serviço", /\b(?:ghp_[A-Za-z0-9]{30,}|xox[bpa]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{32,})\b/g],
  ["Authorization com token", /Bearer\s+[A-Za-z0-9._-]{30,}/g],
];
const IP_PRIVADO = /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g;

const achados = [];
const segredos = segredosReais();
for (const arq of arquivos(dist)) {
  const nome = relative(dist, arq).replace(/\\/g, "/");
  if (arq.endsWith(".map")) { achados.push(`${nome}: source map publicado`); continue; }
  if (!/\.(js|css|html|json|svg|txt|webmanifest)$/.test(arq)) continue;
  const texto = readFileSync(arq, "utf8");
  if (/sourceMappingURL=/.test(texto)) achados.push(`${nome}: referência a source map`);
  for (const [rotulo, valor] of segredos) if (texto.includes(valor)) achados.push(`${nome}: contém o valor real de ${rotulo}`);
  for (const [rotulo, re] of PADROES) if ((texto.match(re) ?? []).length) achados.push(`${nome}: ${rotulo}`);
  for (const ip of new Set(texto.match(IP_PRIVADO) ?? [])) if (!EXEMPLOS_PERMITIDOS.includes(ip)) achados.push(`${nome}: endereço privado ${ip}`);
}

console.log(`Varridos ${arquivos(dist).length} arquivos de dist/ (${segredos.size} segredo(s) reais conferidos: ${[...segredos.keys()].join(", ") || "nenhum encontrado"}).`);
if (achados.length) {
  console.error(`\nEncontrado:\n- ${achados.join("\n- ")}`);
  process.exit(1);
}
console.log("Nada encontrado.");
