import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";
import { extrairClasses, validarClasses } from "./lint-tailwind.mjs";

const require = createRequire(import.meta.url);
const config = require("../tailwind.config.cjs");

test("rejeita tokens inexistentes e variantes inválidas, aceita CSS local e valores arbitrários", () => {
  assert.deepEqual(validarClasses([
    "bg-surface-raised", "hover:bg-surface-raised/50", "bg-surface-inexistente",
    "hover:bg-surface-inexistente", "inventado:bg-surface-raised", "flxe",
    "bottom-[calc(var(--ecos-safe-bottom)+5.5rem)]", "group", "peer/campo", "local",
  ], config, ".local:hover { color: red; }"), [
    "bg-surface-inexistente", "hover:bg-surface-inexistente", "inventado:bg-surface-raised", "flxe",
  ]);
});

test("detecta a regressão original se o token raised for removido", () => {
  const semRaised = { ...config, theme: { ...config.theme, extend: { ...config.theme.extend, colors: { ...config.theme.extend.colors, surface: {} } } } };
  assert.deepEqual(validarClasses(["bg-surface-raised"], semRaised), ["bg-surface-raised"]);
});

test("extrai classes de JSX, constantes, helpers e condicionais sem incluir condições", () => {
  const source = ts.createSourceFile("fixture.tsx", `
    const base = "bg-surface-raised";
    const estilo = (ativo) => ativo ? "text-text-primary" : "text-error";
    const el = <div className={\`fixed \${base} \${tipo === "erro" ? "border-error" : "border-border"}\`} />;
    const outro = <div className={estilo(true)} />;
  `, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const host = ts.createCompilerHost({});
  host.getSourceFile = (name) => name === "fixture.tsx" ? source : undefined;
  const program = ts.createProgram(["fixture.tsx"], { noLib: true }, host);
  assert.deepEqual(new Set(extrairClasses(program).map(({ classe }) => classe)), new Set([
    "fixed", "bg-surface-raised", "border-error", "border-border", "text-text-primary", "text-error",
  ]));
});
