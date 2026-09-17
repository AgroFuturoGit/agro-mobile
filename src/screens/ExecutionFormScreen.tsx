import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button, HelperText, Text, TextInput } from "react-native-paper";

import { useSync } from "@/contexts/SyncContext";
import {
  createProductionExecution,
  updateProductionExecution,
} from "@/domain/production";
import { ApiError, parseFieldErrors } from "@/lib/api";
import {
  formatDate,
  parseDateInput,
  parseDecimal,
  toIsoDate,
} from "@/lib/format";
import {
  captureCoordinates,
  describeLocationFailure,
  formatCoordinates,
  isLocationFromAnotherDay,
  type LocationResult,
} from "@/lib/location";
import type { RootStackParamList } from "@/navigation/types";
import { brand, spacing } from "@/theme";

type Props = NativeStackScreenProps<RootStackParamList, "ExecutionForm">;

export function ExecutionFormScreen({ route, navigation }: Props) {
  const { plan, execution } = route.params;
  const { online } = useSync();
  const isEditing = execution !== undefined;

  const [actualYield, setActualYield] = useState(
    execution ? String(execution.actualYield).replace(".", ",") : "",
  );
  const [harvestDate, setHarvestDate] = useState(
    formatDate(execution?.harvestDate ?? toIsoDate()),
  );
  const [submitting, setSubmitting] = useState(false);
  /** `null` enquanto a primeira leitura do GPS não terminou. */
  const [location, setLocation] = useState<LocationResult | null>(null);
  /** O usuário descartou a posição — diferente de o GPS ter falhado. */
  const [locationRemoved, setLocationRemoved] = useState(false);
  const [recapturing, setRecapturing] = useState(false);
  const [errors, setErrors] = useState<{
    actualYield?: string;
    harvestDate?: string;
    form?: string;
  }>({});

  // A permissão é pedida ao abrir o formulário, não no boot do app: o usuário
  // entende o pedido quando ele chega junto da ação que o justifica. A leitura
  // já começa aqui para que, na hora de salvar, a posição normalmente esteja
  // pronta e o botão não precise esperar.
  useEffect(() => {
    let ativo = true;
    void captureCoordinates().then((resultado) => {
      if (ativo) setLocation(resultado);
    });
    return () => {
      ativo = false;
    };
  }, []);

  async function handleRecapture() {
    setRecapturing(true);
    setLocationRemoved(false);
    setLocation(await captureCoordinates());
    setRecapturing(false);
  }

  function handleRemoveLocation() {
    setLocationRemoved(true);
  }

  async function handleSubmit() {
    const parsedYield = parseDecimal(actualYield);
    const parsedDate = parseDateInput(harvestDate);

    const nextErrors: typeof errors = {};
    if (parsedYield === null) {
      nextErrors.actualYield = "Informe a quantidade colhida";
    } else if (parsedYield < 0) {
      nextErrors.actualYield = "A quantidade não pode ser negativa";
    }
    if (!parsedDate) nextErrors.harvestDate = "Use o formato dd/mm/aaaa";

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setSubmitting(true);

    // Quem removeu a posição não quer que ela volte por uma nova tentativa.
    const posicao = locationRemoved
      ? null
      : location?.status === "ok"
        ? location
        : await captureCoordinates();

    if (posicao) setLocation(posicao);

    const coords = posicao?.status === "ok" ? posicao.coordinates : null;

    const payload = {
      actualYield: parsedYield as number,
      harvestDate: parsedDate as string,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      locationAccuracy: coords?.accuracy ?? null,
      locationRecordedAt: coords?.recordedAt ?? null,
      // Só faz sentido ao editar: sinaliza a remoção deliberada de uma posição
      // que já estava gravada.
      clearLocation: isEditing && locationRemoved,
    };

    try {
      const result = isEditing
        ? await updateProductionExecution(execution, payload)
        : await createProductionExecution(plan.id, payload);

      navigation.goBack();
      void result;
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = parseFieldErrors(error.payload);
        setErrors({
          actualYield: fields.actualYield,
          harvestDate: fields.harvestDate,
          form: Object.keys(fields).length === 0 ? error.message : undefined,
        });
      } else {
        setErrors({ form: "Não foi possível salvar o apontamento." });
      }
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Text variant="titleMedium" style={styles.bold}>
            {isEditing ? "Editar apontamento" : "Registrar colheita"}
          </Text>
          <Text variant="bodySmall" style={styles.muted}>
            {plan.crop?.name ?? "Plano"} · Safra {plan.harvest?.label ?? "—"}
          </Text>
        </View>

        {!online ? (
          <View style={styles.offlineNotice}>
            <Text variant="bodySmall" style={styles.muted}>
              Sem sinal: o registro fica salvo no aparelho e sobe sozinho quando
              a conexão voltar.
            </Text>
          </View>
        ) : null}

        {errors.form ? (
          <View style={styles.errorBox}>
            <Text variant="bodySmall" style={styles.errorText}>
              {errors.form}
            </Text>
          </View>
        ) : null}

        <View>
          <TextInput
            label="Quantidade colhida"
            value={actualYield}
            onChangeText={setActualYield}
            mode="outlined"
            keyboardType="decimal-pad"
            placeholder="0,00"
            error={Boolean(errors.actualYield)}
            disabled={submitting}
          />
          <HelperText type={errors.actualYield ? "error" : "info"} visible>
            {errors.actualYield ??
              "Mesma unidade usada na produção esperada do plano."}
          </HelperText>
        </View>

        <View>
          <TextInput
            label="Data da colheita"
            value={harvestDate}
            onChangeText={setHarvestDate}
            mode="outlined"
            keyboardType="numbers-and-punctuation"
            placeholder="dd/mm/aaaa"
            right={
              <TextInput.Icon
                icon="calendar-today"
                onPress={() => setHarvestDate(formatDate(toIsoDate()))}
                accessibilityLabel="Usar a data de hoje"
              />
            }
            error={Boolean(errors.harvestDate)}
            disabled={submitting}
          />
          <HelperText type={errors.harvestDate ? "error" : "info"} visible>
            {errors.harvestDate ?? "Toque no ícone para usar a data de hoje."}
          </HelperText>
        </View>

        {/*
          O estado do GPS aparece antes de salvar, e não depois: o agricultor
          decide se vale sair do galpão para registrar com posição ou se salva
          assim mesmo. Nenhum dos casos bloqueia o botão.
        */}
        {/*
          O estado do GPS aparece antes de salvar, e não depois: o agricultor vê
          a coordenada e a precisão, e decide se aquela posição descreve mesmo o
          lugar da colheita. Nenhum caminho aqui bloqueia o salvamento.
        */}
        <View style={styles.locationBox}>
          <View style={styles.locationRow}>
            <MaterialCommunityIcons
              name={
                locationRemoved
                  ? "map-marker-off"
                  : location === null || recapturing
                    ? "crosshairs-gps"
                    : location.status === "ok"
                      ? "map-marker-check"
                      : "map-marker-off"
              }
              size={18}
              color={
                locationRemoved
                  ? brand.muted
                  : location === null || recapturing
                    ? brand.muted
                    : location.status === "ok"
                      ? brand.primary
                      : brand.warning
              }
            />
            <Text variant="bodySmall" style={styles.locationText}>
              {locationRemoved
                ? "Sem localização — este apontamento será salvo sem posição."
                : recapturing || location === null
                  ? "Obtendo a localização..."
                  : location.status === "ok"
                    ? formatCoordinates(location.coordinates)
                    : describeLocationFailure(location.status)}
            </Text>
          </View>

          {/*
            A data da colheita é escolhida pelo usuário e pode ser retroativa,
            mas a posição é sempre a de agora. Quem colhe de manhã e registra à
            noite, em casa, grava a coordenada da casa — este aviso é o que
            torna isso visível a tempo de corrigir.
          */}
          {!locationRemoved &&
          location?.status === "ok" &&
          parseDateInput(harvestDate) &&
          isLocationFromAnotherDay(
            location.coordinates.recordedAt,
            parseDateInput(harvestDate) as string,
          ) ? (
            <View style={styles.locationRow}>
              <MaterialCommunityIcons
                name="alert-outline"
                size={16}
                color={brand.warning}
              />
              <Text variant="bodySmall" style={styles.locationWarning}>
                Esta posição é de hoje, mas a colheita é de{" "}
                {formatDate(parseDateInput(harvestDate))}. Pode não ser o local
                da colheita.
              </Text>
            </View>
          ) : null}

          <View style={styles.locationActions}>
            <Button
              mode="text"
              compact
              icon="crosshairs-gps"
              onPress={handleRecapture}
              disabled={submitting || recapturing}
            >
              Atualizar
            </Button>
            {!locationRemoved && location?.status === "ok" ? (
              <Button
                mode="text"
                compact
                icon="close"
                textColor={brand.muted}
                onPress={handleRemoveLocation}
                disabled={submitting || recapturing}
              >
                Remover
              </Button>
            ) : null}
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            mode="text"
            onPress={navigation.goBack}
            disabled={submitting}
            style={styles.flex}
          >
            Cancelar
          </Button>
          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={submitting}
            disabled={submitting}
            style={styles.flex}
          >
            Salvar
          </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.surface },
  content: { padding: spacing.xl, gap: spacing.md },
  bold: { fontWeight: "600" },
  muted: { color: brand.muted },
  locationBox: {
    borderWidth: 1,
    borderColor: brand.border,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  locationRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  locationText: { color: brand.muted, flex: 1 },
  locationWarning: { color: brand.warning, flex: 1 },
  locationActions: { flexDirection: "row", justifyContent: "flex-end" },
  offlineNotice: {
    backgroundColor: "#F1F5F9",
    padding: spacing.md,
    borderRadius: 10,
  },
  errorBox: {
    backgroundColor: brand.dangerLight,
    padding: spacing.md,
    borderRadius: 10,
  },
  errorText: { color: brand.danger },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  flex: { flex: 1 },
});
