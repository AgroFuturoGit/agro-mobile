import * as Location from "expo-location";

import { captureCoordinates, describeLocationFailure } from "@/lib/location";

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
function leitura(latitude: number, longitude: number) {
  return { coords: { latitude, longitude } } as Awaited<
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

    await expect(captureCoordinates()).resolves.toEqual({
      status: "ok",
      coordinates: { latitude: -9.7521, longitude: -36.6612 },
    });
  });

  it("pede a permissão antes de tentar ler a posição", async () => {
    posicaoAtual.mockResolvedValue(leitura(0, 0));

    await captureCoordinates();

    expect(pedirPermissao).toHaveBeenCalledTimes(1);
  });

  it("preserva a coordenada zero, que é uma posição válida", async () => {
    posicaoAtual.mockResolvedValue(leitura(0, 0));

    await expect(captureCoordinates()).resolves.toEqual({
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
