import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { status, configurar, desbloquear, trancar, configurarTempo, tirarCadeado } = vi.hoisted(() => ({
  status: vi.fn(), configurar: vi.fn(), desbloquear: vi.fn(), trancar: vi.fn(), configurarTempo: vi.fn(), tirarCadeado: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...real, seguro: { ...real.seguro, status, configurar, desbloquear, trancar, configurarTempo, tirarCadeado } };
});

import type { SeguroEstado } from "@/lib/api";
import { assinaturaSeguro, publicarEstadoSeguro, trancaQueCobre } from "@/lib/pastas-trancadas";
import { PastasTrancadasScreen } from "./PastasTrancadasScreen";

const base = (extra: Partial<SeguroEstado> = {}): SeguroEstado => ({
  mestra: { configurada: true, aberta: false, minutos: 5, restante_s: null }, mostrar_tarefas: false, pastas: [], ...extra,
});
const abrir = () => render(<MemoryRouter><PastasTrancadasScreen /></MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); publicarEstadoSeguro(null); });

describe("trancaQueCobre", () => {
  const estado = base({ pastas: [{ pasta: "Diário", propria: false, aberta: false, minutos: 5, restante_s: null }] });
  it("acha a própria pasta e as filhas, mas não pastas parecidas", () => {
    expect(trancaQueCobre(estado, "Diário")?.pasta).toBe("Diário");
    expect(trancaQueCobre(estado, "Diário/2026")?.pasta).toBe("Diário");
    expect(trancaQueCobre(estado, "Diário 2")).toBeNull();
    expect(trancaQueCobre(estado, "")).toBeNull();
    expect(trancaQueCobre(null, "Diário")).toBeNull();
  });
  it("a assinatura muda quando uma pasta abre", () => {
    const aberta = base({ pastas: [{ pasta: "Diário", propria: false, aberta: true, minutos: 5, restante_s: 60 }] });
    expect(assinaturaSeguro(estado)).not.toBe(assinaturaSeguro(aberta));
  });
});

describe("Configurações › Pastas trancadas", () => {
  it("sem senha-mestra, oferece criar uma e só habilita com 8 caracteres iguais", async () => {
    status.mockResolvedValue(base({ mestra: { configurada: false, aberta: false, minutos: 5, restante_s: null } }));
    configurar.mockResolvedValue(base());
    abrir();
    const criar = await screen.findByRole("button", { name: "Criar senha" });
    fireEvent.change(screen.getByLabelText("Senha-mestra"), { target: { value: "curta" } });
    expect((criar as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Senha-mestra"), { target: { value: "senha-comprida" } });
    fireEvent.change(screen.getByLabelText("Repita a senha"), { target: { value: "senha-comprida" } });
    fireEvent.click(criar);
    await waitFor(() => expect(configurar).toHaveBeenCalledWith("senha-comprida"));
  });

  it("lista as pastas com cadeado, destranca com a senha e só deixa tirar o cadeado aberta", async () => {
    const trancada = base({ pastas: [{ pasta: "Diário", propria: false, aberta: false, minutos: 5, restante_s: null }] });
    status.mockResolvedValue(trancada);
    desbloquear.mockResolvedValue(base({ pastas: [{ pasta: "Diário", propria: false, aberta: true, minutos: 5, restante_s: 300 }] }));
    abrir();
    expect(await screen.findByText("Diário")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Tirar cadeado/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Destrancar/ }));
    fireEvent.change(await screen.findByLabelText("Senha"), { target: { value: "minha-senha-1" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Destrancar" }).at(-1)!);
    await waitFor(() => expect(desbloquear).toHaveBeenCalledWith("minha-senha-1", undefined));
    await waitFor(() => expect((screen.getByRole("button", { name: /Tirar cadeado/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("o interruptor de tarefas privadas grava a preferência", async () => {
    status.mockResolvedValue(base());
    configurarTempo.mockResolvedValue(base({ mostrar_tarefas: true }));
    abrir();
    fireEvent.click(await screen.findByRole("switch", { name: "Mostrar tarefas de pastas trancadas" }));
    await waitFor(() => expect(configurarTempo).toHaveBeenCalledWith({ mostrar_tarefas: true }));
  });
});
