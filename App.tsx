import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { PaperProvider } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "@/contexts/AuthContext";
import { SyncProvider } from "@/contexts/SyncContext";
import { RootNavigator } from "@/navigation/RootNavigator";
import { theme } from "@/theme";

/**
 * O react-native-paper procura por `react-native-vector-icons`, que exige
 * link nativo e não roda no Expo Go. Apontar o renderizador de ícones para o
 * `@expo/vector-icons` (já embarcado no Expo) resolve sem build nativo.
 */
const paperSettings = {
  icon: ({
    name,
    color,
    size,
  }: {
    name: string;
    color?: string;
    size: number;
  }) => (
    <MaterialCommunityIcons
      name={name as keyof typeof MaterialCommunityIcons.glyphMap}
      color={color}
      size={size}
    />
  ),
};

export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme} settings={paperSettings}>
        <AuthProvider>
          <SyncProvider>
            <StatusBar style="dark" />
            <RootNavigator />
          </SyncProvider>
        </AuthProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
