import { useEffect, useMemo } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { useNavigation } from "@react-navigation/native";
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { Card, Chip, FAB, Text } from "react-native-paper";

import { OfflineBanner } from "@/components/OfflineBanner";
import {
  CacheHint,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/StateViews";
import { useAuth, useCanWrite } from "@/contexts/AuthContext";
import { useSync } from "@/contexts/SyncContext";
import {
  type Farmer,
  farmerDisplayName,
  fetchMyFarmer,
} from "@/domain/farmers";
import {
  fetchProductionPlans,
  overlayPlans,
  type ProductionPlan,
} from "@/domain/production";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { CacheKeys } from "@/lib/cache";
import { formatDate, formatNumber } from "@/lib/format";
import type {
  PlansStackParamList,
  RootStackParamList,
} from "@/navigation/types";
import { brand, spacing } from "@/theme";

type Props = NativeStackScreenProps<PlansStackParamList, "Plans">;

export function PlansScreen({ route, navigation }: Props) {
  const { user } = useAuth();
  const canWrite = useCanWrite();
  const { entries } = useSync();
  const rootNavigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const paramFarmerId = route.params?.farmerId ?? null;

  // FARMER descobre o próprio cadastro em `/farmers/me`; os demais
  // perfis chegam aqui com o agricultor já escolhido na tela anterior.
  const myFarmerQuery = useCachedQuery<Farmer>(
    !paramFarmerId && user?.role === "FARMER" ? CacheKeys.myFarmer : null,
    fetchMyFarmer,
  );

  const farmerId = paramFarmerId ?? myFarmerQuery.data?.id ?? null;
  const farmerName =
    route.params?.farmerName ??
    (myFarmerQuery.data ? farmerDisplayName(myFarmerQuery.data) : "");

  const plansQuery = useCachedQuery<ProductionPlan[]>(
    farmerId ? CacheKeys.plans(farmerId) : null,
    () => fetchProductionPlans(farmerId as string),
  );

  const plans = useMemo(
    () =>
      farmerId
        ? overlayPlans(farmerId, plansQuery.data ?? [], entries)
        : [],
    [farmerId, plansQuery.data, entries],
  );

  useEffect(() => {
    navigation.setOptions({
      title: farmerName ? `Planos · ${farmerName}` : "Planos de produção",
    });
  }, [navigation, farmerName]);

  const resolving =
    myFarmerQuery.loading || (!farmerId && !plansQuery.error);
  const farmerError = myFarmerQuery.error;

  if (farmerError && !farmerId) {
    return (
      <View style={styles.container}>
        <OfflineBanner />
        <ErrorState message={farmerError} onRetry={myFarmerQuery.refetch} />
      </View>
    );
  }

  if (resolving && plans.length === 0) {
    return (
      <View style={styles.container}>
        <OfflineBanner />
        <LoadingState label="Carregando planos..." />
      </View>
    );
  }

  if (plansQuery.error && plans.length === 0) {
    return (
      <View style={styles.container}>
        <OfflineBanner />
        <ErrorState message={plansQuery.error} onRetry={plansQuery.refetch} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <OfflineBanner />

      <FlatList
        data={plans}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          plans.length === 0 && styles.emptyContent,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={plansQuery.refreshing}
            onRefresh={plansQuery.refetch}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="sprout-outline"
            title="Nenhum plano de produção"
            description={
              canWrite
                ? "Cadastre o primeiro plano para começar a registrar a colheita."
                : "Este agricultor ainda não tem planos cadastrados."
            }
          />
        }
        ListFooterComponent={
          plans.length > 0 ? (
            <CacheHint
              cachedAt={plansQuery.cachedAt}
              stale={plansQuery.stale}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <PlanCard
            plan={item}
            onPress={() =>
              navigation.navigate("PlanDetail", {
                planId: item.id,
                farmerId: farmerId as string,
                farmerName,
              })
            }
          />
        )}
      />

      {canWrite && farmerId ? (
        <FAB
          icon="plus"
          label="Novo plano"
          style={styles.fab}
          onPress={() => rootNavigation.navigate("PlanForm", { farmerId })}
        />
      ) : null}
    </View>
  );
}

function PlanCard({
  plan,
  onPress,
}: {
  plan: ProductionPlan;
  onPress: () => void;
}) {
  return (
    <Card mode="outlined" style={styles.card} onPress={onPress}>
      <Card.Content style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleBlock}>
            <Text variant="titleMedium" style={styles.cardTitle}>
              {plan.crop?.name ?? "Cultura não informada"}
            </Text>
            {plan.crop?.variety ? (
              <Text variant="bodySmall" style={styles.muted}>
                {plan.crop.variety}
              </Text>
            ) : null}
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

        <View style={styles.metrics}>
          <Metric label="Área" value={`${formatNumber(plan.plantedArea)} ha`} />
          <Metric label="Esperado" value={formatNumber(plan.expectedYield)} />
          <Metric
            label="Plantio"
            value={formatDate(plan.plannedPlantingDate)}
          />
        </View>

        {plan.harvest ? (
          <Text variant="bodySmall" style={styles.muted}>
            Safra {plan.harvest.label}
          </Text>
        ) : null}
      </Card.Content>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text variant="labelSmall" style={styles.muted}>
        {label}
      </Text>
      <Text variant="titleSmall">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.background },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: 96 },
  emptyContent: { flexGrow: 1 },
  card: { backgroundColor: brand.surface, borderColor: brand.border },
  cardContent: { gap: spacing.md },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cardTitleBlock: { flex: 1 },
  cardTitle: { fontWeight: "600" },
  pendingChip: { backgroundColor: brand.warningLight },
  pendingChipText: { color: brand.warning, fontSize: 12 },
  metrics: { flexDirection: "row", gap: spacing.xl },
  metric: { gap: 2 },
  muted: { color: brand.muted },
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: brand.primary,
  },
});
