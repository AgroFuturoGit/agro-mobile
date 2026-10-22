import { Linking, Platform } from "react-native";

import * as Location from "expo-location";

export type Coordinates = {
  latitude: number;
  longitude: number;
  /** Raio de erro, em metros: separa quem localiza o talhão de quem aponta a cidade. */
  accuracy: number | null;
  /** Quando o GPS leu — não quando o apontamento foi salvo, que pode ser horas depois. */
  recordedAt: string;
};

/** Por que falhou: "sem sinal" e "permissão negada" pedem reações diferentes. */
export type LocationFailure = "denied" | "disabled" | "timeout" | "error";

export type LocationResult =
  { status: "ok"; coordinates: Coordinates } | { status: LocationFailure };

/*
 * Três prazos, e não um: sob mata fechada a primeira leitura leva dezenas de
 * segundos, mas prazo longo só cabe enquanto ninguém olha para a tela.
 */

/** Corre em segundo plano enquanto o usuário digita; ninguém espera por ela. */
export const LOCATION_TIMEOUT_BACKGROUND_MS = 25000;

/** Pedida pelo botão: o usuário vê o indicador girando e sabe que pediu. */
export const LOCATION_TIMEOUT_RECAPTURE_MS = 15000;

/** Última tentativa ao salvar: aqui o usuário quer o registro, não a coordenada. */
export const LOCATION_TIMEOUT_SUBMIT_MS = 5000;

/**
 * `getCurrentPositionAsync` não aceita prazo, então ele é imposto por corrida.
 * A leitura perdedora segue até o fim e é descartada — gasta bateria por
 * segundos, mas nada fica preso esperando por ela.
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
 * Posição atual, desistindo depois de `prazoMs`. Nunca lança: toda falha vira
 * `status`, porque o apontamento precisa ser salvo de qualquer forma.
 */
export async function captureCoordinates(
  prazoMs: number = LOCATION_TIMEOUT_BACKGROUND_MS,
): Promise<LocationResult> {
  try {
    // Pedida junto da ação, não no boot: assim o pedido faz sentido.
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
 * A data da colheita é escolhida pelo usuário e pode ser retroativa, mas a
 * coordenada é sempre a de agora. Quem colhe de manhã e registra à noite grava
 * a casa, e nada no dado denuncia — comparar as datas é o que permite avisar.
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

/**
 * Abre no app de mapas do aparelho, que já pode ter regiões baixadas — e não
 * custa dependência, chave de API nem rebuild. `geo:` e `maps:` são por
 * plataforma; o endereço web cobre o caso de nenhum ser atendido.
 */
export async function openInMaps(
  coordinates: Coordinates,
  label = "Apontamento",
): Promise<boolean> {
  const { latitude, longitude } = coordinates;
  const par = `${latitude},${longitude}`;

  const nativo =
    Platform.OS === "ios"
      ? `maps:0,0?q=${encodeURIComponent(label)}@${par}`
      : `geo:0,0?q=${par}(${encodeURIComponent(label)})`;

  const web = `https://www.google.com/maps/search/?api=1&query=${par}`;

  try {
    if (await Linking.canOpenURL(nativo)) {
      await Linking.openURL(nativo);
      return true;
    }
    await Linking.openURL(web);
    return true;
  } catch {
    return false;
  }
}
