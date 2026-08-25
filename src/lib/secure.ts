import { Platform } from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

/**
 * Token JWT no keystore/keychain do aparelho.
 *
 * `expo-secure-store` não existe na web (`expo start --web`), então lá cai
 * para AsyncStorage — aceitável porque a web é só ferramenta de depuração;
 * no alvo real (Android/iOS via Expo Go) o token nunca sai do SecureStore.
 */
const TOKEN_KEY = "produplan_token";

const isWeb = Platform.OS === "web";

export async function saveToken(token: string): Promise<void> {
  if (isWeb) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function loadToken(): Promise<string | null> {
  try {
    if (isWeb) return await AsyncStorage.getItem(TOKEN_KEY);
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function deleteToken(): Promise<void> {
  try {
    if (isWeb) {
      await AsyncStorage.removeItem(TOKEN_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Se não deu para apagar, o logout ainda limpa o estado em memória.
  }
}
