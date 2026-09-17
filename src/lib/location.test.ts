import { Linking } from "react-native";

import * as Location from "expo-location";

import {
  captureCoordinates,
  describeLocationFailure,
  formatCoordinates,
  isLocationFromAnotherDay,
  openInMaps,
} from "@/lib/location";

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  Linking: { canOpenURL: jest.fn(), openURL: jest.fn() },
}));

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const pedirPermissao =
  Location.requestForegroundPermissionsAsync as jest.MockedFunction<
    typeof Location.requestForegroundPermissionsAsync
  >;
const servicoLigado = Location.hasServicesEnabledAsync as jest.MockedFunction<
  typeof Location.hasServicesEnabledAsync
>;
const posicaoAtual = Location.getCurrentPositionAsync as jest.MockedFunction<
  typeof Location.getCurrentPositionAsync
>;

/** Só o que `captureCoordinates` lê do retorno do Expo. */
function leitura(
  latitude: number,
  longitude: number,
  accuracy: number | null = 8,
  timestamp = Date.UTC(2026, 8, 17, 12, 0),
) {
  return { coords: { latitude, longitude, accuracy }, timestamp } as Awaited<
    ReturnType<typeof Location.getCurrentPositionAsync>
  >;
}

function permitido(granted: boolean) {
  return { granted } as Awaited<
    ReturnType<typeof Location.requestForegroundPermissionsAsync>
  >;
}

beforeEach(() => {
  jest.clearAllMocks();
  pedirPermissao.mockResolvedValue(permitido(true));
  servicoLigado.mockResolvedValue(true);
});

describe("captureCoordinates", () => {
  it("devolve as coordenadas quando o GPS responde", async () => {
    posicaoAtual.mockResolvedValue(leitura(-9.7521, -36.6612));

    await expect(captureCoordinates()).resolves.toMatchObject({
      status: "ok",
      coordinates: { latitude: -9.7521, longitude: -36.6612, accuracy: 8 },
    });
  });

  it("pede a permissão antes de tentar ler a posição", async () => {
    posicaoAtual.mockResolvedValue(leitura(0, 0));

    await captureCoordinates();

    expect(pedirPermissao).toHaveBeenCalledTimes(1);
  });

  it("preserva a coordenada zero, que é uma posição válida", async () => {
    posicaoAtual.mockResolvedValue(leitura(0, 0));

    await expect(captureCoordinates()).resolves.toMatchObject({
      status: "ok",
      coordinates: { latitude: 0, longitude: 0 },
    });
  });

  it("não tenta ler a posição quando a permissão é negada", async () => {
    pedirPermissao.mockResolvedValue(permitido(false));

    await expect(captureCoordinates()).resolves.toEqual({ status: "denied" });
    expect(posicaoAtual).not.toHaveBeenCalled();
  });

  it("avisa quando a localização do aparelho está desligada", async () => {
    servicoLigado.mockResolvedValue(false);

    await expect(captureCoordinates()).resolves.toEqual({ status: "disabled" });
    expect(posicaoAtual).not.toHaveBeenCalled();
  });

  it("desiste quando o GPS não responde dentro do prazo", async () => {
    jest.useFakeTimers();
    // Uma leitura que nunca resolve: é o caso do aparelho sem visada de céu.
    posicaoAtual.mockReturnValue(new Promise(() => {}));

    const resultado = captureCoordinates(3000);
    // A variante assíncrona é necessária: a permissão e a checagem do serviço
    // são aguardadas antes de o cronômetro existir, e avançar o relógio sem
    // deixar essas promessas resolverem travaria o teste.
    await jest.advanceTimersByTimeAsync(3000);

    await expect(resultado).resolves.toEqual({ status: "timeout" });
    jest.useRealTimers();
  });

  it("aceita a leitura que chega antes do prazo", async () => {
    jest.useFakeTimers();
    posicaoAtual.mockReturnValue(
      new Promise((resolve) => {
        setTimeout(() => resolve(leitura(-9.75, -36.66)), 1000);
      }),
    );

    const resultado = captureCoordinates(3000);
    await jest.advanceTimersByTimeAsync(1000);

    await expect(resultado).resolves.toMatchObject({ status: "ok" });
    jest.useRealTimers();
  });

  it("trata falha do GPS como ausência de posição, sem lançar", async () => {
    posicaoAtual.mockRejectedValue(new Error("location unavailable"));

    await expect(captureCoordinates()).resolves.toEqual({ status: "timeout" });
  });

  it("não lança quando o próprio pedido de permissão falha", async () => {
    pedirPermissao.mockRejectedValue(new Error("indisponível"));

    await expect(captureCoordinates()).resolves.toEqual({ status: "error" });
  });
});

describe("describeLocationFailure", () => {
  it("explica cada motivo sem culpar o usuário", () => {
    expect(describeLocationFailure("denied")).toContain("permissão");
    expect(describeLocationFailure("disabled")).toContain("desligada");
    expect(describeLocationFailure("timeout")).toContain("não respondeu");
    expect(describeLocationFailure("error")).toBe("Salvo sem localização.");
  });
});

describe("dados que acompanham a coordenada", () => {
  it("guarda a precisão informada pelo GPS", async () => {
    posicaoAtual.mockResolvedValue(leitura(-9.75, -36.66, 42));

    const r = await captureCoordinates();

    expect(r).toMatchObject({ coordinates: { accuracy: 42 } });
  });

  it("aceita leitura sem precisão conhecida", async () => {
    posicaoAtual.mockResolvedValue(leitura(-9.75, -36.66, null));

    const r = await captureCoordinates();

    expect(r).toMatchObject({ coordinates: { accuracy: null } });
  });

  it("guarda quando o GPS obteve a posição, não quando foi salvo", async () => {
    const quando = Date.UTC(2026, 8, 17, 9, 30);
    posicaoAtual.mockResolvedValue(leitura(-9.75, -36.66, 8, quando));

    const r = await captureCoordinates();

    expect(r).toMatchObject({
      coordinates: { recordedAt: new Date(quando).toISOString() },
    });
  });
});

describe("formatCoordinates", () => {
  const base = { latitude: -9.7521, longitude: -36.6612, recordedAt: "" };

  it("mostra o par com seis casas e a precisão arredondada", () => {
    expect(formatCoordinates({ ...base, accuracy: 8.4 })).toBe(
      "-9.752100, -36.661200 · ±8 m",
    );
  });

  it("omite a precisão quando o GPS não a informou", () => {
    expect(formatCoordinates({ ...base, accuracy: null })).toBe(
      "-9.752100, -36.661200",
    );
  });
});

describe("isLocationFromAnotherDay", () => {
  it("acusa a posição capturada em dia diferente do da colheita", () => {
    // O caso real: colheu de manhã no talhão, registrou à noite em casa.
    expect(
      isLocationFromAnotherDay("2026-09-17T23:10:00.000Z", "2026-09-12"),
    ).toBe(true);
  });

  it("não acusa quando captura e colheita são do mesmo dia", () => {
    expect(
      isLocationFromAnotherDay("2026-09-17T09:30:00.000Z", "2026-09-17"),
    ).toBe(false);
  });

  it("não acusa quando alguma das datas é inválida", () => {
    expect(isLocationFromAnotherDay("", "2026-09-17")).toBe(false);
    expect(isLocationFromAnotherDay("2026-09-17T09:30:00.000Z", "")).toBe(false);
  });
});

describe("openInMaps", () => {
  const podeAbrir = Linking.canOpenURL as jest.MockedFunction<
    typeof Linking.canOpenURL
  >;
  const abrir = Linking.openURL as jest.MockedFunction<typeof Linking.openURL>;
  const coords = {
    latitude: -9.7521,
    longitude: -36.6612,
    accuracy: 8,
    recordedAt: "",
  };

  beforeEach(() => {
    podeAbrir.mockReset();
    abrir.mockReset().mockResolvedValue(true);
  });

  /** O endereço da última chamada, com a checagem que o TypeScript exige. */
  function enderecoAberto(): string {
    const chamada = abrir.mock.calls[0];
    if (!chamada) throw new Error("Linking.openURL não foi chamado");
    return chamada[0];
  }

  it("usa o app de mapas do aparelho quando há um instalado", async () => {
    podeAbrir.mockResolvedValue(true);

    await expect(openInMaps(coords, "Colheita")).resolves.toBe(true);
    expect(enderecoAberto()).toContain("geo:0,0?q=-9.7521,-36.6612");
  });

  it("cai no mapa web quando nenhum app atende o esquema", async () => {
    podeAbrir.mockResolvedValue(false);

    await openInMaps(coords);

    expect(enderecoAberto()).toBe(
      "https://www.google.com/maps/search/?api=1&query=-9.7521,-36.6612",
    );
  });

  it("não lança quando não há como abrir nada", async () => {
    podeAbrir.mockResolvedValue(false);
    abrir.mockRejectedValue(new Error("sem aplicativo"));

    await expect(openInMaps(coords)).resolves.toBe(false);
  });
});
