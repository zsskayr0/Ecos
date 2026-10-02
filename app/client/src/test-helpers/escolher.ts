import { fireEvent, screen, within } from "@testing-library/react";

/** Abre o SeletorEcos pelo rótulo acessível e escolhe a opção pelo texto. */
export function escolher(ariaLabel: string, rotulo: string | RegExp, raiz: HTMLElement = document.body) {
  fireEvent.click(within(raiz).getByRole("button", { name: ariaLabel }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: rotulo }));
}

/** Rótulos das opções do SeletorEcos (abre o menu). */
export function opcoesDe(ariaLabel: string, raiz: HTMLElement = document.body) {
  fireEvent.click(within(raiz).getByRole("button", { name: ariaLabel }));
  return screen.getAllByRole("menuitemradio").map((o) => o.textContent);
}
