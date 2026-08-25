import { StyleSheet, View } from "react-native";

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Button, Text } from "react-native-paper";

import { useAuth } from "@/contexts/AuthContext";
import { useSync } from "@/contexts/SyncContext";
import { brand, spacing } from "@/theme";

type Props = {
  onReauth?: () => void;
};

/**
 * Faixa de estado no topo das telas. Três situações, em ordem de urgência:
 * sessão vencida, sem conexão, ou fila aguardando envio.
 */
export function OfflineBanner({ onReauth }: Props) {
  const { sessionExpired } = useAuth();
  const { online, pendingCount, failedCount, syncing } = useSync();

  if (sessionExpired) {
    return (
      <View style={[styles.banner, styles.warning]}>
        <MaterialCommunityIcons
          name="account-clock-outline"
          size={18}
          color={brand.warning}
        />
        <Text variant="labelMedium" style={styles.warningText}>
          Sessão expirada. Os registros continuam salvos no aparelho.
        </Text>
        {onReauth ? (
          <Button
            compact
            mode="text"
            textColor={brand.warning}
            onPress={onReauth}
          >
            Entrar
          </Button>
        ) : null}
      </View>
    );
  }

  if (!online) {
    return (
      <View style={[styles.banner, styles.offline]}>
        <MaterialCommunityIcons
          name="cloud-off-outline"
          size={18}
          color={brand.muted}
        />
        <Text variant="labelMedium" style={styles.offlineText}>
          Modo offline
          {pendingCount > 0
            ? ` — ${pendingCount} ${pendingCount === 1 ? "envio pendente" : "envios pendentes"}`
            : " — dados salvos no aparelho"}
        </Text>
      </View>
    );
  }

  if (pendingCount > 0 || failedCount > 0) {
    return (
      <View style={[styles.banner, styles.info]}>
        <MaterialCommunityIcons
          name={syncing ? "sync" : "cloud-upload-outline"}
          size={18}
          color={brand.info}
        />
        <Text variant="labelMedium" style={styles.infoText}>
          {syncing
            ? "Sincronizando..."
            : failedCount > 0
              ? `${failedCount} ${failedCount === 1 ? "envio recusado" : "envios recusados"} — veja em Sincronização`
              : `${pendingCount} ${pendingCount === 1 ? "envio pendente" : "envios pendentes"}`}
        </Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  offline: { backgroundColor: "#F1F5F9" },
  offlineText: { color: brand.muted, flex: 1 },
  warning: { backgroundColor: brand.warningLight },
  warningText: { color: brand.warning, flex: 1 },
  info: { backgroundColor: brand.infoLight },
  infoText: { color: brand.info, flex: 1 },
});
