import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
import postcss from "postcss";

const require = createRequire(import.meta.url);
// Tailwind 3 não expõe uma API pública de validação de candidatos.
// Os testes deste script protegem esta integração ao atualizar a dependência.
const { createContext } = require("tailwindcss/lib/lib/setupContextUtils");
const { generateRules } = require("tailwindcss/lib/lib/generateRules");
const resolveConfig = require("tailwindcss/resolveConfig");
const selectorParser = require("postcss-selector-parser");
const root = fileURLToPath(new URL("../", import.meta.url));

export function validarClasses(classes, config, css = "") {
  const context = createContext(resolveConfig(config));
  const customizadas = new Set();
  postcss.parse(css).walkRules((rule) => {
    selectorParser((selectors) => selectors.walkClasses((node) => customizadas.add(node.value))).processSync(rule.selector);
  });
  return [...new Set(classes)].filter((classe) =>
    !customizadas.has(classe) && !/^(group|peer)(\/[^\s]+)?$/.test(classe)
    && generateRules(new Set([classe]), context).length === 0);
}

export function extrairClasses(program) {
  const checker = program.getTypeChecker();
  const ocorrencias = [];
  const vistos = new Set();
  function coletar(node) {
    if (!node || vistos.has(node)) return;
    vistos.add(node);
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const source = node.getSourceFile();
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      for (const classe of node.text.split(/\s+/).filter(Boolean)) ocorrencias.push({ classe, arquivo: source.fileName, linha: line + 1 });
    } else if (ts.isConditionalExpression(node)) {
      coletar(node.whenTrue);
      coletar(node.whenFalse);
    } else if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
      for (const declaration of symbol?.declarations ?? []) coletar(declaration.initializer);
    } else if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) coletar(node.left);
      coletar(node.right);
    } else if (ts.isCallExpression(node)) {
      // Helpers locais que retornam classes; argumentos podem ser condições.
      const symbol = checker.getSymbolAtLocation(node.expression);
      for (const declaration of symbol?.declarations ?? []) coletar(declaration.body ?? declaration.initializer);
    } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      coletar(node.body);
    } else if (ts.isBlock(node)) {
      for (const statement of node.statements) if (ts.isReturnStatement(statement)) coletar(statement.expression);
    } else if (ts.isTemplateExpression(node)) {
      coletar(node.head);
      for (const span of node.templateSpans) { coletar(span.expression); coletar(span.literal); }
    } else if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
      coletar(node.expression);
    }
  }
  function visitar(node) {
    if ((ts.isJsxAttribute(node) || ts.isPropertyAssignment(node)) && node.name.getText() === "className") coletar(node.initializer);
    ts.forEachChild(node, visitar);
  }
  for (const source of program.getSourceFiles()) if (!source.isDeclarationFile && !source.fileName.includes("node_modules")) visitar(source);
  return ocorrencias;
}

function listar(dir, extensao) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? listar(file, extensao) : extensao.test(file) ? [file] : [];
  });
}

function main() {
  const files = listar(path.join(root, "src"), /(?<!\.test)\.tsx?$/);
  const program = ts.createProgram(files, { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, baseUrl: root, paths: { "@/*": ["src/*"] } });
  const ocorrencias = extrairClasses(program);
  const css = listar(path.join(root, "src"), /\.css$/).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const invalidas = new Set(validarClasses(ocorrencias.map(({ classe }) => classe), require(path.join(root, "tailwind.config.cjs")), css));
  const baseline = JSON.parse(fs.readFileSync(path.join(root, "scripts/tailwind-baseline.json"), "utf8"));
  let erros = 0;
  let conhecidas = 0;
  for (const { classe, arquivo, linha } of ocorrencias) if (invalidas.has(classe)) {
    const relativo = path.relative(root, arquivo).replaceAll("\\", "/");
    const key = `${relativo}:${classe}`;
    if (baseline[key] > 0) { baseline[key]--; conhecidas++; continue; }
    console.error(`${relativo}:${linha}: classe inexistente: ${classe}`);
    erros++;
  }
  if (erros) process.exitCode = 1;
  else console.log(`Tailwind: ${new Set(ocorrencias.map(({ classe }) => classe)).size} classes verificadas; ${conhecidas} ocorrências preexistentes na baseline.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
