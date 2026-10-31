/** Sufixo numérico para distinguir arquivos exportados com o mesmo período. */
export function sequenciaExportacao(): string {
  return crypto.getRandomValues(new Uint32Array(1))[0].toString().padStart(10, "0");
}
