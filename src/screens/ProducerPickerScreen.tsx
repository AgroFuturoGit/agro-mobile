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
  fetchProducers,
  type Producer,
  producerDisplayName,
} from "@/domain/producers";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { CacheKeys } from "@/lib/cache";
import type { PlansStackParamList } from "@/navigation/types";
import { brand, spacing } from "@/theme";

type Props = NativeStackScreenProps<PlansStackParamList, "ProducerPicker">;

export function ProducerPickerScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  // `GET /producers` exige ADMIN ou MANAGER (ver `ProducerController`).
  // Para TECHNICIAN a API não expõe nenhuma rota de descoberta de produtores,
  // então nem vale disparar a requisição — mostramos o porquê.
  const canList = user?.role === "ADMIN" || user?.role === "MANAGER";

  const query = useCachedQuery<Producer[]>(
    canList ? CacheKeys.producers() : null,
    fetchProducers,
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

  if (!canList) {
    return (
      <View style={styles.container}>
        <OfflineBanner />
        <EmptyState
          icon="account-search-outline"
          title="Seleção de produtor indisponível"
          description={
            user?.role === "TECHNICIAN"
              ? "A API não expõe listagem de produtores para o perfil Técnico (GET /producers exige ADMIN ou MANAGER). Peça acesso a um desses perfis para consultar planos por aqui."
              : "Seu perfil não tem permissão para listar produtores."
          }
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
