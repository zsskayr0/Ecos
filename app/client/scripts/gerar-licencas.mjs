#!/usr/bin/env node
// Gera THIRD-PARTY-NOTICES (raiz do repositório) e src/assets/licencas.json (tela Sobre > Licenças).
// Requer: `cargo install cargo-about --locked --features cli` e `npm ci` (usa license-checker via npx).
// Uso: npm run licencas
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliente = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const raiz = resolve(cliente, "../..");
const sh = process.platform === "win32";
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 29, shell: sh, stdio: ["ignore", "pipe", "inherit"] });
const norm = (t) => t.replace(/\r\n/g, "\n").trim();

/** grupos[chave] = { id, nome, texto, pacotes: Map } — mesmo texto de licença é impresso uma vez. */
const grupos = new Map();
function adicionar(id, nome, texto, pacote) {
  const t = norm(texto);
  const chave = `${id}\n${t}`;
  if (!grupos.has(chave)) grupos.set(chave, { id, nome, texto: t, pacotes: new Map() });
  grupos.get(chave).pacotes.set(`${pacote.eco}:${pacote.nome}@${pacote.versao}`, pacote);
}

// Rust: servidor, cofre e o app Tauri (workspace próprio em src-tauri).
for (const manifesto of ["app/server", "app/vault", "app/client/src-tauri"]) {
  const j = JSON.parse(run("cargo", ["about", "generate", "--format", "json", "--manifest-path", `${manifesto}/Cargo.toml`, "-c", "about.toml"], raiz));
  for (const l of j.licenses)
    for (const u of l.used_by) {
      const p = u.crate;
      adicionar(l.id, l.name, l.text, { eco: "cargo", nome: p.name, versao: p.version, repo: p.repository ?? null });
    }
}

/** Arquivo apontado pelo license-checker; se for um README, junta os arquivos LICENSE e COPYING da pasta do pacote. */
function textoLicenca(info) {
  const ehLicenca = (f) => /licen[cs]e|copying/i.test(basename(f));
  if (info.licenseFile && ehLicenca(info.licenseFile) && existsSync(info.licenseFile)) return readFileSync(info.licenseFile, "utf8");
  const arquivos = readdirSync(info.path).filter((f) => ehLicenca(f) && !/\.(js|ts|cjs|mjs)$/.test(f));
  return arquivos.map((f) => readFileSync(resolve(info.path, f), "utf8")).join("\n\n");
}

// npm: só dependências de produção (o que vai no bundle). @napi-rs/canvas é opcional do pdfjs-dist só para Node e não entra no app.
const npm = JSON.parse(run("npx", ["--yes", "license-checker-rseidelsohn", "--production", "--excludePrivatePackages", "--excludePackagesStartingWith", "@napi-rs/canvas", "--json"], cliente));
for (const [chave, info] of Object.entries(npm)) {
  const i = chave.lastIndexOf("@");
  const nome = chave.slice(0, i), versao = chave.slice(i + 1);
  const texto = textoLicenca(info);
  if (!texto) throw new Error(`Sem arquivo de licença para ${chave} (${info.licenses}); resolva manualmente.`);
  const id = String(info.licenses).replace(/[()*]/g, "");
  adicionar(id, id, texto, { eco: "npm", nome, versao, repo: info.repository ?? null });
}

const lista = [...grupos.values()]
  .map((g) => ({ ...g, pacotes: [...g.pacotes.values()].sort((a, b) => a.nome.localeCompare(b.nome) || a.versao.localeCompare(b.versao)) }))
  .sort((a, b) => a.id.localeCompare(b.id) || b.pacotes.length - a.pacotes.length);
const total = new Set(lista.flatMap((g) => g.pacotes.map((p) => `${p.eco}:${p.nome}@${p.versao}`))).size;
const dia = new Date().toISOString().slice(0, 10);

const CABECALHO = `Avisos de terceiros — Ecos
==========================

O Ecos inclui software e ativos de terceiros, listados abaixo com suas licenças.
Arquivo gerado por app/client/scripts/gerar-licencas.mjs (npm run licencas). Não edite à mão.
Gerado em ${dia}. ${total} pacotes.

Fontes (SIL Open Font License 1.1, via @fontsource)
---------------------------------------------------
- Inter — Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)
- Space Grotesk — Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)
- JetBrains Mono — Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)
Os textos completos da OFL 1.1 estão na seção OFL-1.1 abaixo.

Ícones e marca
--------------
- Ícones da interface: Lucide (ISC; trechos derivados do Feather sob MIT) — ver pacote lucide-react abaixo.
- Marca e ícone do Ecos (assets/brand, favicon e src-tauri/icons): criação do projeto Ecos; o nome e a marca Ecos não são licenciados para uso como identidade de terceiros.
- Google Calendar, Outlook e Apple Calendar/iCal são marcas registradas de seus respectivos titulares
  (Google LLC, Microsoft Corporation e Apple Inc.). Aparecem no Ecos apenas como referência nominativa em texto,
  para indicar compatibilidade; o Ecos não usa seus logotipos e não é afiliado, patrocinado ou endossado por eles.

Licenças das dependências
-------------------------
`;

let out = CABECALHO;
for (const g of lista) {
  out += `\n${"=".repeat(78)}\n${g.id} — ${g.nome} (${g.pacotes.length} pacote${g.pacotes.length > 1 ? "s" : ""})\n${"=".repeat(78)}\n`;
  out += g.pacotes.map((p) => `  ${p.nome} ${p.versao}${p.repo ? ` — ${p.repo}` : ""}`).join("\n");
  out += `\n\n${g.texto}\n`;
}
writeFileSync(resolve(raiz, "THIRD-PARTY-NOTICES"), out);

writeFileSync(
  resolve(cliente, "src/assets/licencas.json"),
  JSON.stringify({ geradoEm: dia, total, grupos: lista.map((g) => ({ id: g.id, nome: g.nome, texto: g.texto, pacotes: g.pacotes.map((p) => [p.nome, p.versao, p.eco]) })) }),
);
console.log(`${total} pacotes em ${lista.length} grupos de licença.`);
