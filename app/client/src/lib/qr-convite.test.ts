import { expect, it } from "vitest";
import { codigoDoQrConvite } from "./qr-convite";

it("lê o código do link do convite e do texto solto", () => {
  expect(codigoDoQrConvite("https://ecos.exemplo.com/entrar/a1b2c3d4")).toBe("A1B2C3D4");
  expect(codigoDoQrConvite("http://192.168.0.5:8080/entrar/A1B2C3D4/")).toBe("A1B2C3D4");
  expect(codigoDoQrConvite(" a1b2c3d4 ")).toBe("A1B2C3D4");
});

it("ignora QR codes que não são convites", () => {
  expect(codigoDoQrConvite("https://exemplo.com/outra/pagina")).toBeNull();
  expect(codigoDoQrConvite("olá mundo")).toBeNull();
});
