import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Button,
  Dialog,
  HelperText,
  Portal,
  RadioButton,
  Text,
  TextInput,
} from "react-native-paper";

import { useSync } from "@/contexts/SyncContext";
import {
  type Crop,
  cropLabel,
  fetchCrops,
  fetchHarvests,
  type Harvest,
} from "@/domain/catalog";
import {
  createProductionPlan,
  updateProductionPlan,
} from "@/domain/production";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { ApiError, parseFieldErrors } from "@/lib/api";
import { CacheKeys } from "@/lib/cache";
import { formatDate, parseDateInput, parseDecimal } from "@/lib/format";
import type { RootStackParamList } from "@/navigation/types";
import { brand, spacing } from "@/theme";

type Props = NativeStackScreenProps<RootStackParamList, "PlanForm">;

export function PlanFormScreen({ route, navigation }: Props) {
  const { producerId, plan } = route.params;
  const { online } = useSync();
  const isEditing = plan !== undefined;

  // Na edição a API não aceita trocar cultura/safra, então nem baixa as
  // listas — o plano já traz o que precisa ser exibido.
  const cropsQuery = useCachedQuery<Crop[]>(
    isEditing ? null : CacheKeys.crops,
    fetchCrops,
  );
  const harvestsQuery = useCachedQuery<Harvest[]>(
    isEditing ? null : CacheKeys.harvests,
    fetchHarvests,
  );

  const [cropId, setCropId] = useState<string | null>(plan?.crop?.id ?? null);
  const [harvestId, setHarvestId] = useState<string | null>(
    plan?.harvest?.id ?? null,
  );
  const [plantedArea, setPlantedArea] = useState(
    plan ? String(plan.plantedArea).replace(".", ",") : "",
  );
  const [expectedYield, setExpectedYield] = useState(
    plan ? String(plan.expectedYield).replace(".", ",") : "",
  );
  const [plantingDate, setPlantingDate] = useState(
    plan?.plannedPlantingDate ? formatDate(plan.plannedPlantingDate) : "",
  );

  const [picker, setPicker] = useState<"crop" | "harvest" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const crops = cropsQuery.data ?? [];
  const harvests = harvestsQuery.data ?? [];

  const selectedCrop =
    plan?.crop ?? crops.find((item) => item.id === cropId) ?? null;
  const selectedHarvest =
    plan?.harvest ?? harvests.find((item) => item.id === harvestId) ?? null;

  async function handleSubmit() {
    const parsedArea = parseDecimal(plantedArea);
    const parsedYield = parseDecimal(expectedYield);
    const parsedDate = plantingDate.trim()
      ? parseDateInput(plantingDate)
      : null;

    const nextErrors: Record<string, string | undefined> = {};
    if (!isEditing && !cropId) nextErrors.cropId = "Escolha a cultura";
    if (!isEditing && !harvestId) nextErrors.harvestId = "Escolha a safra";
    if (parsedArea === null || parsedArea <= 0) {
      nextErrors.plantedArea = "Informe a área plantada em hectares";
    }
    if (parsedYield === null || parsedYield <= 0) {
      nextErrors.expectedYield = "Informe a produção esperada";
    }
    if (plantingDate.trim() && !parsedDate) {
      nextErrors.plannedPlantingDate = "Use o formato dd/mm/aaaa";
    }

    if (Object.values(nextErrors).some(Boolean)) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setSubmitting(true);

    try {
      if (isEditing) {
        await updateProductionPlan(plan, producerId, {
          plantedArea: parsedArea as number,
          expectedYield: parsedYield as number,
          plannedPlantingDate: parsedDate,
        });
      } else {
        await createProductionPlan(
          producerId,
          {
            cropId: cropId as string,
            harvestId: harvestId as string,
            plantedArea: parsedArea as number,
            expectedYield: parsedYield as number,
            plannedPlantingDate: parsedDate,
          },
          {
            crop: selectedCrop
              ? {
                  id: selectedCrop.id,
                  name: selectedCrop.name,
                  variety: selectedCrop.variety,
                }
              : null,
            harvest: selectedHarvest
              ? {
                  id: selectedHarvest.id,
                  label: selectedHarvest.label,
                  startDate: selectedHarvest.startDate,
                  endDate: selectedHarvest.endDate,
                }
              : null,
          },
        );
      }

      navigation.goBack();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = parseFieldErrors(error.payload);
        setErrors({
          ...fields,
          form: Object.keys(fields).length === 0 ? error.message : undefined,
        });
      } else {
        setErrors({ form: "Não foi possível salvar o plano." });
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
        <Text variant="titleMedium" style={styles.bold}>
          {isEditing ? "Editar plano" : "Novo plano de produção"}
        </Text>

        {!online ? (
          <View style={styles.notice}>
            <Text variant="bodySmall" style={styles.muted}>
              Sem sinal: o plano fica salvo no aparelho. Só será possível
              registrar colheitas nele depois de sincronizar.
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
            label="Cultura"
            value={selectedCrop ? cropLabel(selectedCrop) : ""}
            mode="outlined"
            editable={false}
            placeholder="Escolha a cultura"
            right={
              !isEditing ? (
                <TextInput.Icon
                  icon="chevron-down"
                  onPress={() => setPicker("crop")}
                />
              ) : undefined
            }
            onPressIn={!isEditing ? () => setPicker("crop") : undefined}
            error={Boolean(errors.cropId)}
            disabled={submitting}
          />
          {isEditing ? (
            <HelperText type="info" visible>
              A API não permite trocar cultura ou safra de um plano existente.
            </HelperText>
          ) : errors.cropId ? (
            <HelperText type="error" visible>
              {errors.cropId}
            </HelperText>
          ) : null}
        </View>

        {!isEditing || plan?.harvest ? (
          <View>
            <TextInput
              label="Safra"
              value={selectedHarvest?.label ?? ""}
              mode="outlined"
              editable={false}
              placeholder="Escolha a safra"
              right={
                !isEditing ? (
                  <TextInput.Icon
                    icon="chevron-down"
                    onPress={() => setPicker("harvest")}
                  />
                ) : undefined
              }
              onPressIn={!isEditing ? () => setPicker("harvest") : undefined}
              error={Boolean(errors.harvestId)}
              disabled={submitting}
            />
            {errors.harvestId ? (
              <HelperText type="error" visible>
                {errors.harvestId}
              </HelperText>
            ) : null}
          </View>
        ) : null}

        <View>
          <TextInput
            label="Área plantada (ha)"
            value={plantedArea}
            onChangeText={setPlantedArea}
            mode="outlined"
            keyboardType="decimal-pad"
            placeholder="0,00"
            error={Boolean(errors.plantedArea)}
            disabled={submitting}
          />
          {errors.plantedArea ? (
            <HelperText type="error" visible>
              {errors.plantedArea}
            </HelperText>
          ) : null}
        </View>

        <View>
          <TextInput
            label="Produção esperada"
            value={expectedYield}
            onChangeText={setExpectedYield}
            mode="outlined"
            keyboardType="decimal-pad"
            placeholder="0,00"
            error={Boolean(errors.expectedYield)}
            disabled={submitting}
          />
          {errors.expectedYield ? (
            <HelperText type="error" visible>
              {errors.expectedYield}
            </HelperText>
          ) : null}
        </View>

        <View>
          <TextInput
            label="Plantio previsto (opcional)"
            value={plantingDate}
            onChangeText={setPlantingDate}
            mode="outlined"
            keyboardType="numbers-and-punctuation"
            placeholder="dd/mm/aaaa"
            error={Boolean(errors.plannedPlantingDate)}
            disabled={submitting}
          />
          {errors.plannedPlantingDate ? (
            <HelperText type="error" visible>
              {errors.plannedPlantingDate}
            </HelperText>
          ) : null}
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

      <Portal>
        <Dialog visible={picker !== null} onDismiss={() => setPicker(null)}>
          <Dialog.Title>
            {picker === "crop" ? "Escolha a cultura" : "Escolha a safra"}
          </Dialog.Title>
          <Dialog.ScrollArea style={styles.dialogArea}>
            <ScrollView>
              {picker === "crop" ? (
                <RadioButton.Group
                  value={cropId ?? ""}
                  onValueChange={(value) => {
                    setCropId(value);
                    setPicker(null);
                  }}
                >
                  {crops.map((crop) => (
                    <RadioButton.Item
                      key={crop.id}
                      label={cropLabel(crop)}
                      value={crop.id}
                    />
                  ))}
                  {crops.length === 0 ? (
                    <Text variant="bodySmall" style={styles.dialogEmpty}>
                      Nenhuma cultura em cache. Conecte-se uma vez para baixar a
                      lista.
                    </Text>
                  ) : null}
                </RadioButton.Group>
              ) : (
                <RadioButton.Group
                  value={harvestId ?? ""}
                  onValueChange={(value) => {
                    setHarvestId(value);
                    setPicker(null);
                  }}
                >
                  {harvests.map((harvest) => (
                    <RadioButton.Item
                      key={harvest.id}
                      label={harvest.label}
                      value={harvest.id}
                    />
                  ))}
                  {harvests.length === 0 ? (
                    <Text variant="bodySmall" style={styles.dialogEmpty}>
                      Nenhuma safra em cache. Conecte-se uma vez para baixar a
                      lista.
                    </Text>
                  ) : null}
                </RadioButton.Group>
              )}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setPicker(null)}>Fechar</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.surface },
  content: { padding: spacing.xl, gap: spacing.sm },
  bold: { fontWeight: "600", marginBottom: spacing.sm },
  muted: { color: brand.muted },
  notice: {
    backgroundColor: "#F1F5F9",
    padding: spacing.md,
    borderRadius: 10,
    marginBottom: spacing.sm,
  },
  errorBox: {
    backgroundColor: brand.dangerLight,
    padding: spacing.md,
    borderRadius: 10,
    marginBottom: spacing.sm,
  },
  errorText: { color: brand.danger },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  flex: { flex: 1 },
  dialogArea: { paddingHorizontal: 0, maxHeight: 360 },
  dialogEmpty: { color: brand.muted, padding: spacing.lg },
});
