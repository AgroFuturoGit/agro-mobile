import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
import {
  Button,
  Card,
  Chip,
  Dialog,
  Divider,
  FAB,
  IconButton,
  Portal,
  ProgressBar,
  Snackbar,
  Text,
} from "react-native-paper";

import { OfflineBanner } from "@/components/OfflineBanner";
import { CacheHint, EmptyState, LoadingState } from "@/components/StateViews";
import { useCanWrite } from "@/contexts/AuthContext";
import { useSync } from "@/contexts/SyncContext";
import {
  canReceiveExecutions,
  computeComparison,
  deleteProductionExecution,
  deleteProductionPlan,
  fetchProductionExecutions,
  fetchProductionPlans,
  overlayExecutions,
  overlayPlans,
  type ProductionExecution,
  type ProductionPlan,
} from "@/domain/production";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { ApiError } from "@/lib/api";
import { CacheKeys } from "@/lib/cache";
import { formatDate, formatNumber } from "@/lib/format";
import { isLocalId } from "@/lib/outbox";
import type {
  PlansStackParamList,
  RootStackParamList,
} from "@/navigation/types";
import { brand, spacing } from "@/theme";

type Props = NativeStackScreenProps<PlansStackParamList, "PlanDetail">;

export function PlanDetailScreen({ route, navigation }: Props) {
  const { planId, farmerId } = route.params;
  const canWrite = useCanWrite();
  const { entries } = useSync();
  const rootNavigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [toast, setToast] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<ProductionExecution | null>(null);
  const [confirmPlanDelete, setConfirmPlanDelete] = useState(false);

  // O plano vem da lista já em cache: assim a tela abre igual online ou
  // offline, e planos ainda na fila (id local) também aparecem.
  const plansQuery = useCachedQuery<ProductionPlan[]>(
    CacheKeys.plans(farmerId),
    () => fetchProductionPlans(farmerId),
  );

  const plan = useMemo(
    () =>
      overlayPlans(farmerId, plansQuery.data ?? [], entries).find(
        (item) => item.id === planId,
      ) ?? null,
    [farmerId, plansQuery.data, entries, planId],
  );

  const isLocalPlan = isLocalId(planId);

  const executionsQuery = useCachedQuery<ProductionExecution[]>(
    isLocalPlan ? null : CacheKeys.executions(planId),
    () => fetchProductionExecutions(planId),
  );

  const executions = useMemo(
    () => overlayExecutions(planId, executionsQuery.data ?? [], entries),
    [planId, executionsQuery.data, entries],
  );

  const comparison = useMemo(
    () => (plan ? computeComparison(plan, executions) : null),
    [plan, executions],
  );

  useEffect(() => {
    navigation.setOptions({
      title: plan?.crop?.name ?? "Plano de produção",
    });
  }, [navigation, plan]);

  const handleDeleteExecution = useCallback(async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);

    try {
      const result = await deleteProductionExecution(target);
      setToast(
        result.synced
          ? "Apontamento excluído."
          : "Exclusão salva no aparelho — vai subir quando houver sinal.",
      );
    } catch (error) {
      setToast(
        error instanceof ApiError
          ? error.message
          : "Não foi possível excluir o apontamento.",
      );
    }
  }, [pendingDelete]);

  const handleDeletePlan = useCallback(async () => {
    if (!plan) return;
    setConfirmPlanDelete(false);

    try {
      const result = await deleteProductionPlan(plan, farmerId);
      navigation.goBack();
      if (!result.synced) {
        // Sem sinal a exclusão fica na fila; o usuário precisa saber disso.
        setToast("Exclusão salva no aparelho.");
      }
    } catch (error) {
      setToast(
        error instanceof ApiError
          ? error.message
          : "Não foi possível excluir o plano.",
      );
    }
  }, [plan, farmerId, navigation]);

  if (!plan) {
    if (plansQuery.loading) {
      return (
        <View style={styles.container}>
          <OfflineBanner />
          <LoadingState label="Carregando plano..." />
        </View>
      );
    }

    return (
      <View style={styles.container}>
        <OfflineBanner />
        <EmptyState
          icon="file-remove-outline"
          title="Plano não encontrado"
          description="Ele pode ter sido excluído por outra pessoa."
          actionLabel="Voltar"
          onAction={navigation.goBack}
        />
      </View>
    );
  }

  const acceptsExecutions = canReceiveExecutions(plan);

  return (
    <View style={styles.container}>
      <OfflineBanner />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={plansQuery.refreshing || executionsQuery.refreshing}
            onRefresh={() => {
              void plansQuery.refetch();
              void executionsQuery.refetch();
            }}
          />
        }
      >
        <Card mode="outlined" style={styles.card}>
          <Card.Content style={styles.cardContent}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text variant="titleMedium" style={styles.bold}>
                  {plan.crop?.name ?? "Cultura não informada"}
                </Text>
                <Text variant="bodySmall" style={styles.muted}>
                  {plan.crop?.variety ? `${plan.crop.variety} · ` : ""}
                  Safra {plan.harvest?.label ?? "—"}
                </Text>
              </View>

              {plan.pending ? (
                <Chip
                  compact
                  icon="cloud-upload-outline"
                  style={styles.pendingChip}
                  textStyle={styles.pendingChipText}
                >
                  {plan.pending === "create" ? "A enviar" : "Editado"}
                </Chip>
              ) : null}
            </View>

            <Divider />

            <View style={styles.infoGrid}>
              <Info
                label="Área plantada"
                value={`${formatNumber(plan.plantedArea)} ha`}
              />
              <Info
                label="Produção esperada"
                value={formatNumber(plan.expectedYield)}
              />
              <Info
                label="Plantio previsto"
                value={formatDate(plan.plannedPlantingDate)}
              />
              <Info
                label="Período da safra"
                value={
                  plan.harvest
                    ? `${formatDate(plan.harvest.startDate)} a ${formatDate(plan.harvest.endDate)}`
                    : "—"
                }
              />
            </View>

            {canWrite ? (
              <View style={styles.cardActions}>
                <Button
                  mode="text"
                  icon="pencil-outline"
                  onPress={() =>
                    rootNavigation.navigate("PlanForm", { farmerId, plan })
                  }
                >
                  Editar
                </Button>
                <Button
                  mode="text"
                  icon="trash-can-outline"
                  textColor={brand.danger}
                  onPress={() => setConfirmPlanDelete(true)}
                >
                  Excluir
                </Button>
              </View>
            ) : null}
          </Card.Content>
        </Card>

        {comparison ? (
          <Card mode="outlined" style={styles.card}>
            <Card.Content style={styles.cardContent}>
              <Text variant="titleSmall" style={styles.bold}>
                Previsto x realizado
              </Text>

              <ProgressBar
                progress={Math.max(
                  0,
                  Math.min(1, comparison.percentageRealized / 100),
                )}
                color={
                  comparison.difference >= 0 ? brand.primary : brand.warning
                }
                style={styles.progress}
              />

              <View style={styles.rowBetween}>
                <Info
                  label="Realizado"
                  value={formatNumber(comparison.totalActualYield)}
                />
                <Info
                  label="Esperado"
                  value={formatNumber(comparison.expectedYield)}
                />
                <Info
                  label="Diferença"
                  value={`${comparison.difference >= 0 ? "+" : ""}${formatNumber(comparison.difference)}`}
                  tone={comparison.difference >= 0 ? "positive" : "negative"}
                />
                <Info
                  label="Atingido"
                  value={`${formatNumber(comparison.percentageRealized, 1)}%`}
                />
              </View>

              <Text variant="bodySmall" style={styles.muted}>
                Calculado no aparelho, incluindo apontamentos ainda não
                enviados.
              </Text>
            </Card.Content>
          </Card>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text variant="titleSmall" style={styles.bold}>
            Apontamentos de colheita
          </Text>
          <Text variant="bodySmall" style={styles.muted}>
            {executions.length}
          </Text>
        </View>

        {!acceptsExecutions ? (
          <Card mode="outlined" style={[styles.card, styles.noticeCard]}>
            <Card.Content style={styles.notice}>
              <MaterialCommunityIcons
                name="information-outline"
                size={20}
                color={brand.warning}
              />
              <Text variant="bodySmall" style={styles.noticeText}>
                Este plano ainda não foi enviado ao servidor. Sincronize para
                poder registrar a colheita nele.
              </Text>
            </Card.Content>
          </Card>
        ) : executionsQuery.loading && executions.length === 0 ? (
          <LoadingState label="Carregando apontamentos..." />
        ) : executions.length === 0 ? (
          <EmptyState
            icon="basket-outline"
            title="Nenhuma colheita registrada"
            description={
              canWrite
                ? "Toque em Registrar colheita para lançar o primeiro apontamento."
                : "Nada lançado neste plano até agora."
            }
          />
        ) : (
          <View style={styles.executionList}>
            {executions.map((execution) => (
              <ExecutionRow
                key={execution.id}
                execution={execution}
                canWrite={canWrite}
                onEdit={() =>
                  rootNavigation.navigate("ExecutionForm", { plan, execution })
                }
                onDelete={() => setPendingDelete(execution)}
              />
            ))}
          </View>
        )}

        <CacheHint
          cachedAt={executionsQuery.cachedAt ?? plansQuery.cachedAt}
          stale={executionsQuery.stale || plansQuery.stale}
        />
      </ScrollView>

      {canWrite && acceptsExecutions ? (
        <FAB
          icon="plus"
          label="Registrar colheita"
          style={styles.fab}
          onPress={() => rootNavigation.navigate("ExecutionForm", { plan })}
        />
      ) : null}

      <Portal>
        <Dialog
          visible={pendingDelete !== null}
          onDismiss={() => setPendingDelete(null)}
        >
          <Dialog.Title>Excluir apontamento</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              O registro de {formatDate(pendingDelete?.harvestDate ?? null)}{" "}
              será removido.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPendingDelete(null)}>Cancelar</Button>
            <Button textColor={brand.danger} onPress={handleDeleteExecution}>
              Excluir
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog
          visible={confirmPlanDelete}
          onDismiss={() => setConfirmPlanDelete(false)}
        >
          <Dialog.Title>Excluir plano</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              O plano e os apontamentos ligados a ele deixam de aparecer. Não dá
              para desfazer.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmPlanDelete(false)}>
              Cancelar
            </Button>
            <Button textColor={brand.danger} onPress={handleDeletePlan}>
              Excluir
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

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

function ExecutionRow({
  execution,
  canWrite,
  onEdit,
  onDelete,
}: {
  execution: ProductionExecution;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card mode="outlined" style={styles.card}>
      <Card.Content style={styles.executionRow}>
        <View style={styles.flex}>
          <Text variant="titleSmall">
            {formatNumber(execution.actualYield)}
          </Text>
          <Text variant="bodySmall" style={styles.muted}>
            Colheita em {formatDate(execution.harvestDate)}
          </Text>
        </View>

        {execution.pending ? (
          <Chip
            compact
            icon="cloud-upload-outline"
            style={styles.pendingChip}
            textStyle={styles.pendingChipText}
          >
            {execution.pending === "create" ? "A enviar" : "Editado"}
          </Chip>
        ) : null}

        {canWrite ? (
          <View style={styles.rowActions}>
            <IconButton icon="pencil-outline" size={20} onPress={onEdit} />
            <IconButton
              icon="trash-can-outline"
              size={20}
              iconColor={brand.danger}
              onPress={onDelete}
            />
          </View>
        ) : null}
      </Card.Content>
    </Card>
  );
}

function Info({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  const toneStyle =
    tone === "positive"
      ? styles.positive
      : tone === "negative"
        ? styles.negative
        : undefined;

  return (
    <View style={styles.info}>
      <Text variant="labelSmall" style={styles.muted}>
        {label}
      </Text>
      <Text variant="titleSmall" style={toneStyle}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 96 },
  card: { backgroundColor: brand.surface, borderColor: brand.border },
  cardContent: { gap: spacing.md },
  cardActions: { flexDirection: "row", justifyContent: "flex-end" },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  rowActions: { flexDirection: "row" },
  flex: { flex: 1 },
  bold: { fontWeight: "600" },
  muted: { color: brand.muted },
  positive: { color: brand.primary },
  negative: { color: brand.warning },
  infoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.md,
    columnGap: spacing.xl,
  },
  info: { gap: 2, minWidth: 72 },
  progress: { height: 8, borderRadius: 4 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  executionList: { gap: spacing.sm },
  executionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  noticeCard: {
    backgroundColor: brand.warningLight,
    borderColor: brand.warningLight,
  },
  notice: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  noticeText: { color: brand.warning, flex: 1 },
  pendingChip: { backgroundColor: brand.warningLight },
  pendingChipText: { color: brand.warning, fontSize: 12 },
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: brand.primary,
  },
});
