import * as Location from "expo-location";

export type Coordinates = {
  latitude: number;
  longitude: number;
  /**
   * Raio de erro da leitura, em metros. É o que separa uma posição que localiza
   * um talhão de uma que só aponta a cidade — por isso vai junto do par, e não
   * como detalhe opcional.
   */
  accuracy: number | null;
  /**
   * Quando o GPS obteve a posição. Diferente do momento em que o apontamento é
   * salvo: o registro pode ser preenchido horas depois, em outro lugar.
   */
  recordedAt: string;
};

/**
 * Por que a captura falhou. A tela usa isso para dizer ao usuário o que
 * aconteceu — "sem sinal de GPS" e "permissão negada" pedem reações diferentes.
 */
export type LocationFailure = "denied" | "disabled" | "timeout" | "error";

export type LocationResult =
  | { status: "ok"; coordinates: Coordinates }
  | { status: LocationFailure };

/**
 * Prazo que o GPS tem para responder antes de o registro seguir sem coordenada.
 *
 * Obter posição não é instantâneo: com o aparelho recém-ligado, sob mata fechada
 * ou dentro de um galpão, a primeira leitura pode levar dezenas de segundos ou
 * nunca chegar. Esperar sem limite deixaria o botão de salvar girando e
 * impediria o agricultor de registrar a colheita — o oposto do que este app
 * existe para fazer.
 */
export const LOCATION_TIMEOUT_MS = 3000;

/**
 * `getCurrentPositionAsync` não aceita prazo: resolve quando conseguir. O limite
 * é imposto aqui, correndo a leitura contra um cronômetro.
 *
 * A leitura perdedora continua em andamento — não há como cancelá-la —, mas seu
 * resultado é descartado. É desperdício de bateria por alguns segundos, não um
 * vazamento: nada fica preso esperando por ela.
 */
function comPrazo<T>(
  promessa: Promise<T>,
  prazoMs: number,
): Promise<T | "timeout"> {
  return new Promise((resolve) => {
    const cronometro = setTimeout(() => resolve("timeout"), prazoMs);

    promessa
      .then((valor) => {
        clearTimeout(cronometro);
        resolve(valor);
      })
      .catch(() => {
        clearTimeout(cronometro);
        resolve("timeout");
      });
  });
}

/**
 * Pede a posição atual, desistindo depois de `prazoMs`.
 *
 * Nunca lança: toda falha vira um `status`, porque quem chama precisa seguir
 * salvando o apontamento de qualquer forma.
 */
export async function captureCoordinates(
  prazoMs: number = LOCATION_TIMEOUT_MS,
): Promise<LocationResult> {
  try {
    // A permissão é pedida aqui, no ato de salvar, e não no boot do app: o
    // usuário entende melhor o pedido quando ele acontece junto da ação.
    const permissao = await Location.requestForegroundPermissionsAsync();
    if (!permissao.granted) return { status: "denied" };

    if (!(await Location.hasServicesEnabledAsync())) {
      return { status: "disabled" };
    }

    const leitura = await comPrazo(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      prazoMs,
    );

    if (leitura === "timeout") return { status: "timeout" };

    return {
      status: "ok",
      coordinates: {
        latitude: leitura.coords.latitude,
        longitude: leitura.coords.longitude,
        accuracy: leitura.coords.accuracy ?? null,
        recordedAt: new Date(leitura.timestamp).toISOString(),
      },
    };
  } catch {
    return { status: "error" };
  }
}

/** Texto curto para a tela, quando a posição não pôde ser capturada. */
export function describeLocationFailure(motivo: LocationFailure): string {
  switch (motivo) {
    case "denied":
      return "Salvo sem localização — o app não tem permissão de acesso ao GPS.";
    case "disabled":
      return "Salvo sem localização — a localização do aparelho está desligada.";
    case "timeout":
      return "Salvo sem localização — o GPS não respondeu a tempo.";
    default:
      return "Salvo sem localização.";
  }
}

/** `-9.752100, -36.661200 · ±8 m` — o formato que a tela mostra. */
export function formatCoordinates(coordinates: Coordinates): string {
  const par = `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`;
  if (coordinates.accuracy === null) return par;
  return `${par} · ±${Math.round(coordinates.accuracy)} m`;
}

/**
 * A posição foi capturada num dia diferente do da colheita?
 *
 * O app captura onde o telefone está no momento de salvar, mas a data da
 * colheita é escolhida pelo usuário e pode ser retroativa. Quem colhe de manhã
 * e registra à noite, em casa, grava a coordenada da casa — e nada no dado
 * denuncia isso. Comparar as duas datas é o que permite avisar.
 */
export function isLocationFromAnotherDay(
  recordedAt: string,
  harvestDate: string,
): boolean {
  const captura = recordedAt.slice(0, 10);
  const colheita = harvestDate.slice(0, 10);
  if (captura.length !== 10 || colheita.length !== 10) return false;
  return captura !== colheita;
}
