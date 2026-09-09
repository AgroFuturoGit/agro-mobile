import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  Button,
  Card,
  Chip,
  Divider,
  IconButton,
  Snackbar,
  Text,
} from "react-native-paper";

import { EmptyState } from "@/components/StateViews";
import { useAuth } from "@/contexts/AuthContext";
import { useSync } from "@/contexts/SyncContext";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { FlushResult, OutboxEntry } from "@/lib/outbox";
import { brand, spacing } from "@/theme";

export function SyncScreen() {
  const { sessionExpired } = useAuth();
  const {
    online,
    connectionType,
    entries,
    pendingCount,
    failedCount,
    conflictCount,
    syncing,
    lastSyncAt,
    sync,
    discard,
    retry,
  } = useSync();

  const [toast, setToast] = useState<string | null>(null);

  async function handleSync() {
    const result = await sync();
    setToast(describeResult(result));
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card mode="outlined" style={styles.card}>
          <Card.Content style={styles.statusCard}>
            <View style={styles.statusRow}>
              <MaterialCommunityIcons
                name={online ? "cloud-check-outline" : "cloud-off-outline"}
                size={28}
                color={online ? brand.primary : brand.muted}
              />
              <View style={styles.flex}>
                <Text variant="titleMedium" style={styles.bold}>
                  {online ? "Conectado" : "Sem conexão"}
                </Text>
                <Text variant="bodySmall" style={styles.muted}>
                  {online
                    ? `Rede: ${connectionType}`
                    : "Os registros ficam guardados no aparelho"}
                </Text>
              </View>
            </View>

            <Divider />

            <View style={styles.counters}>
              <Counter label="Na fila" value={pendingCount} />
              <Counter label="Recusados" value={failedCount} tone="danger" />
              <Counter
                label="Conflitos"
                value={conflictCount}
                tone="warning"
              />
              <Counter
                label="Última sincronização"
                text={lastSyncAt ? formatRelative(lastSyncAt) : "—"}
              />
            </View>

            {sessionExpired ? (
              <View style={styles.warningBox}>
                <MaterialCommunityIcons
                  name="account-clock-outline"
                  size={18}
                  color={brand.warning}
                />
                <Text variant="bodySmall" style={styles.warningText}>
                  Sessão expirada — entre novamente pelo Perfil para conseguir
                  enviar a fila.
                </Text>
              </View>
            ) : null}

            <Button
              mode="contained"
              icon="sync"
              onPress={handleSync}
              loading={syncing}
              disabled={syncing || !online || pendingCount === 0}
            >
              {pendingCount === 0 ? "Nada para enviar" : "Sincronizar agora"}
            </Button>
          </Card.Content>
        </Card>

        {entries.length === 0 ? (
          <EmptyState
            icon="check-circle-outline"
            title="Tudo sincronizado"
            description="Nenhum registro aguardando envio."
          />
        ) : (
          <View style={styles.list}>
            <Text variant="titleSmall" style={styles.bold}>
              Fila de envio
            </Text>
            {entries.map((entry) => (
              <QueueRow
                key={entry.id}
                entry={entry}
                onDiscard={() => discard(entry.id)}
                onRetry={() => retry(entry.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <Snackbar
        visible={toast !== null}
        onDismiss={() => setToast(null)}
        duration={4000}
      >
        {toast ?? ""}
      </Snackbar>
    </View>
  );
}

function QueueRow({
  entry,
  onDiscard,
  onRetry,
}: {
  entry: OutboxEntry;
  onDiscard: () => void;
  onRetry: () => void;
}) {
  const failed = entry.status === "failed";
  const conflict = entry.status === "conflict";

  return (
    <Card mode="outlined" style={styles.card}>
      <Card.Content style={styles.queueRow}>
        <View style={styles.flex}>
          <Text variant="bodyMedium">{entry.label}</Text>
          <Text variant="bodySmall" style={styles.muted}>
            {formatDateTime(entry.createdAt)}
          </Text>
          {entry.lastError ? (
            <Text
              variant="bodySmall"
              style={conflict ? styles.conflictText : styles.errorText}
            >
              {entry.lastError}
            </Text>
          ) : null}
          {conflict ? (
            <Text variant="bodySmall" style={styles.muted}>
              A versão de quem editou antes já está na tela. Descarte esta
              alteração e refaça, se ainda fizer sentido.
            </Text>
          ) : null}
        </View>

        <Chip
          compact
          style={
            conflict
              ? styles.conflictChip
              : failed
                ? styles.failedChip
                : styles.pendingChip
          }
          textStyle={
            conflict
              ? styles.conflictChipText
              : failed
                ? styles.failedChipText
                : styles.pendingChipText
          }
        >
          {conflict ? "Conflito" : failed ? "Recusado" : "Na fila"}
        </Chip>

        {/*
          Reenviar não ajuda num conflito: o item carrega a versão antiga e
          seria recusado de novo. O dado do servidor já está na tela — resta
          descartar e, se ainda fizer sentido, refazer a edição.
        */}
        {failed ? (
          <IconButton icon="refresh" size={20} onPress={onRetry} />
        ) : null}
        <IconButton
          icon="trash-can-outline"
          size={20}
          iconColor={brand.danger}
          onPress={onDiscard}
        />
      </Card.Content>
    </Card>
  );
}

function Counter({
  label,
  value,
  text,
  tone,
}: {
  label: string;
  value?: number;
  text?: string;
  tone?: "danger" | "warning";
}) {
  return (
    <View style={styles.counter}>
      <Text variant="labelSmall" style={styles.muted}>
        {label}
      </Text>
      <Text
        variant="titleMedium"
        style={
          value
            ? tone === "danger"
              ? styles.errorText
              : tone === "warning"
                ? styles.conflictText
                : undefined
            : undefined
        }
      >
        {text ?? value ?? 0}
      </Text>
    </View>
  );
}

function describeResult(result: FlushResult): string {
  switch (result.outcome) {
    case "synced":
      return result.sent > 0
        ? `${result.sent} ${result.sent === 1 ? "registro enviado" : "registros enviados"}.`
        : "Nada pendente para enviar.";
    case "offline":
      return "Sem conexão com o servidor. A fila continua guardada.";
    case "unauthorized":
      return "Sessão expirada. Entre novamente para sincronizar.";
    case "partial": {
      const partes = [
        `${result.sent} enviado(s)`,
        `${result.remaining} na fila`,
        `${result.failed} recusado(s)`,
      ];
      if (result.conflicted > 0) {
        partes.push(`${result.conflicted} em conflito`);
      }
      return `${partes.join(", ")}.`;
    }
    default:
      return "Sincronização em andamento.";
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.background },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: brand.surface, borderColor: brand.border },
  statusCard: { gap: spacing.md },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  counters: { flexDirection: "row", justifyContent: "space-between" },
  counter: { gap: 2 },
  list: { gap: spacing.sm },
  queueRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  flex: { flex: 1 },
  bold: { fontWeight: "600" },
  muted: { color: brand.muted },
  errorText: { color: brand.danger },
  warningBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: brand.warningLight,
    padding: spacing.md,
    borderRadius: 10,
  },
  warningText: { color: brand.warning, flex: 1 },
  pendingChip: { backgroundColor: brand.infoLight },
  pendingChipText: { color: brand.info, fontSize: 12 },
  failedChip: { backgroundColor: brand.dangerLight },
  failedChipText: { color: brand.danger, fontSize: 12 },
  conflictChip: { backgroundColor: brand.warningLight },
  conflictChipText: { color: brand.warning, fontSize: 12 },
  conflictText: { color: brand.warning },
});
