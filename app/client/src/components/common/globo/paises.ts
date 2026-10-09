/** Onde o globo pousa para cada país da lista de Calendário e localização. `raio` (graus) é o tamanho do brilho sobre a terra. */
export interface PaisNoGlobo {
  lat: number;
  lon: number;
  raio: number;
}

export const PAISES_NO_GLOBO: Record<string, PaisNoGlobo> = {
  Brasil: { lat: -14.2, lon: -51.9, raio: 19 },
  Portugal: { lat: 39.6, lon: -8, raio: 3.2 },
  "Estados Unidos": { lat: 39.8, lon: -98.6, raio: 21 },
  Canadá: { lat: 58, lon: -96, raio: 22 },
  México: { lat: 23.6, lon: -102.5, raio: 11 },
  Argentina: { lat: -38.4, lon: -64, raio: 14 },
  Chile: { lat: -33.5, lon: -70.8, raio: 7.5 },
  Colômbia: { lat: 4.6, lon: -74.3, raio: 7 },
  Uruguai: { lat: -32.8, lon: -56, raio: 3.5 },
  "Reino Unido": { lat: 54, lon: -2.5, raio: 4.2 },
  Espanha: { lat: 40.2, lon: -3.7, raio: 6 },
  França: { lat: 46.6, lon: 2.2, raio: 5 },
  Alemanha: { lat: 51.2, lon: 10.4, raio: 4.5 },
  Itália: { lat: 42.8, lon: 12.6, raio: 5 },
  "Países Baixos": { lat: 52.2, lon: 5.3, raio: 2.2 },
  Suíça: { lat: 46.8, lon: 8.2, raio: 2.2 },
  Japão: { lat: 36.2, lon: 138.3, raio: 7 },
  China: { lat: 35.9, lon: 104.2, raio: 17 },
  Índia: { lat: 22.4, lon: 78.9, raio: 13 },
  Austrália: { lat: -25.7, lon: 134, raio: 17 },
};

/** Vista inicial (antes do primeiro giro): o Atlântico, de onde a maioria dos países da lista está a poucos passos. */
export const VISTA_INICIAL = { lat: 12, lon: -30 };
