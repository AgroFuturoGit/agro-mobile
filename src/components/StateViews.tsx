import { StyleSheet, View } from "react-native";

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ActivityIndicator, Button, Text } from "react-native-paper";

import { formatRelative } from "@/lib/format";
import { brand, spacing } from "@/theme";

export function LoadingState({ label = "Carregando..." }: { label?: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator />
      <Text variant="bodyMedium" style={styles.mutedText}>
        {label}
      </Text>
    </View>
  );
}

type EmptyStateProps = {
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({
  icon = "clipboard-text-outline",
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <View style={styles.centered}>
      <MaterialCommunityIcons name={icon} size={44} color={brand.border} />
      <Text variant="titleMedium" style={styles.title}>
        {title}
      </Text>
      {description ? (
        <Text variant="bodyMedium" style={styles.mutedText}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button mode="contained-tonal" onPress={onAction} style={styles.action}>
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.centered}>
      <MaterialCommunityIcons
        name="alert-circle-outline"
        size={44}
        color={brand.danger}
      />
      <Text variant="titleMedium" style={styles.title}>
        Não deu para carregar
      </Text>
      <Text variant="bodyMedium" style={styles.mutedText}>
        {message}
      </Text>
      {onRetry ? (
        <Button mode="contained-tonal" onPress={onRetry} style={styles.action}>
          Tentar novamente
        </Button>
      ) : null}
    </View>
  );
}

/** Rodapé discreto informando a idade do dado exibido. */
export function CacheHint({
  cachedAt,
  stale,
}: {
  cachedAt: number | null;
  stale: boolean;
}) {
  if (!cachedAt) return null;

  return (
    <Text variant="bodySmall" style={styles.cacheHint}>
      {stale ? "Dados salvos no aparelho, " : "Atualizado "}
      {formatRelative(cachedAt)}
    </Text>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.xl,
  },
  title: { textAlign: "center" },
  mutedText: { color: brand.muted, textAlign: "center" },
  action: { marginTop: spacing.sm },
  cacheHint: {
    color: brand.muted,
    textAlign: "center",
    paddingVertical: spacing.lg,
  },
});
