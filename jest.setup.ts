/* eslint-disable @typescript-eslint/no-require-imports --
 * Os mocks oficiais do AsyncStorage e do NetInfo são CommonJS e precisam ser
 * carregados dentro da factory do `jest.mock`, que roda antes dos imports ESM.
 */
/**
 * Mocks das dependências nativas.
 *
 * Os testes cobrem a lógica que decide o que sobe para a API — fila, overlay,
 * comparativo. Nada disso precisa de aparelho, mas os módulos importados no
 * caminho (armazenamento e rede) são nativos e não existem no Node.
 */

// Mock oficial do pacote: guarda em memória e reseta entre testes.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("@react-native-community/netinfo", () =>
  require("@react-native-community/netinfo/jest/netinfo-mock"),
);

// O SecureStore só é exercitado pelo AuthContext, fora do escopo destes
// testes — mas o módulo é carregado pela cadeia de imports.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
