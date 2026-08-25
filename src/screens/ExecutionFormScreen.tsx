import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button, HelperText, Text, TextInput } from "react-native-paper";

import { useSync } from "@/contexts/SyncContext";
import {
  createProductionExecution,
  updateProductionExecution,
} from "@/domain/production";
import { ApiError, parseFieldErrors } from "@/lib/api";
import { formatDate, parseDateInput, parseDecimal, toIsoDate } from "@/lib/format";
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
  const [errors, setErrors] = useState<{
    actualYield?: string;
    harvestDate?: string;
    form?: string;
  }>({});

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

    const payload = {
      actualYield: parsedYield as number,
      harvestDate: parsedDate as string,
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
