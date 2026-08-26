import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Divider, List, Searchbar, Text } from "react-native-paper";

import { OfflineBanner } from "@/components/OfflineBanner";
import {
  CacheHint,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/StateViews";
import { useAuth } from "@/contexts/AuthContext";
import {
  type Producer,
  producerDiscoveryFor,
  producerDisplayName,
} from "@/domain/producers";
import { useCachedQuery } from "@/hooks/use-cached-query";
import type { PlansStackParamList } from "@/navigation/types";
import { brand, spacing } from "@/theme";

type Props = NativeStackScreenProps<PlansStackParamList, "ProducerPicker">;

export function ProducerPickerScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  // Cada papel tem uma rota de descoberta diferente (ADMIN/MANAGER listam
  // todos, TECHNICIAN só os atribuídos). A escolha vive no domínio.
  const discovery = useMemo(
    () => producerDiscoveryFor(user?.role),
    [user?.role],
  );

  const query = useCachedQuery<Producer[]>(
    discovery?.cacheKey ?? null,
    // `key === null` desliga a query, então o fetcher nunca é chamado aqui.
    discovery?.fetch ?? fetchNothing,
  );

  const producers = useMemo(() => {
    const list = query.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return list;

    return list.filter((producer) => {
      const name = producerDisplayName(producer).toLowerCase();
      const community = producer.community?.name.toLowerCase() ?? "";
      return name.includes(term) || community.includes(term);
    });
  }, [query.data, search]);

  const openProducer = useCallback(
    (producer: Producer) => {
      navigation.navigate("Plans", {
        producerId: producer.id,
        producerName: producerDisplayName(producer),
      });
    },
    [navigation],
  );

  if (!discovery) {
    return (
      <View style={styles.container}>
        <OfflineBanner />
        <EmptyState
          icon="account-search-outline"
          title="Seleção de produtor indisponível"
          description="Seu perfil não tem permissão para listar produtores."
        />
      </View>
    );
  }

  if (query.loading) {
    return (
      <View style={styles.container}>
        <OfflineBanner />
        <LoadingState label="Carregando produtores..." />
      </View>
    );
  }

  if (query.error && !query.data) {
    return (
      <View style={styles.container}>
        <OfflineBanner />
        <ErrorState message={query.error} onRetry={query.refetch} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <OfflineBanner />

      <Searchbar
        value={search}
        onChangeText={setSearch}
        placeholder="Buscar produtor ou comunidade"
        style={styles.search}
        inputStyle={styles.searchInput}
      />

      <FlatList
        data={producers}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={Divider}
        refreshControl={
          <RefreshControl
            refreshing={query.refreshing}
            onRefresh={query.refetch}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="account-off-outline"
            title="Nenhum produtor encontrado"
            description={
              search
                ? "Ajuste a busca e tente de novo."
                : user?.role === "TECHNICIAN"
                  ? "Nenhum produtor foi atribuído a você. A vinculação é feita pelo gerente ou administrador no sistema web."
                  : "Nenhum produtor cadastrado até agora."
            }
          />
        }
        ListFooterComponent={
          producers.length > 0 ? (
            <CacheHint cachedAt={query.cachedAt} stale={query.stale} />
          ) : null
        }
        contentContainerStyle={
          producers.length === 0 ? styles.emptyContent : undefined
        }
        renderItem={({ item }) => (
          <List.Item
            title={producerDisplayName(item)}
            description={() => (
              <Text variant="bodySmall" style={styles.muted}>
                {item.community?.name ?? "Sem comunidade"}
                {item.community?.organization
                  ? ` · ${item.community.organization.name}`
                  : ""}
              </Text>
            )}
            left={(props) => <List.Icon {...props} icon="account-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => openProducer(item)}
          />
        )}
      />
    </View>
  );
}

/** Placeholder para quando o papel não tem rota de descoberta. */
function fetchNothing(): Promise<Producer[]> {
  return Promise.resolve([]);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.background },
  search: {
    margin: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: brand.surface,
  },
  searchInput: { minHeight: 0 },
  emptyContent: { flexGrow: 1 },
  muted: { color: brand.muted },
});
