import { apiRequest } from "@/lib/api";
import { CacheKeys, readCache, writeCache } from "@/lib/cache";
import { formatDate, formatNumber } from "@/lib/format";
import { mutate, type MutationResult } from "@/lib/mutate";
import { createLocalId, isLocalId, type OutboxEntry } from "@/lib/outbox";

// ----- Tipos de domínio -----

export type PendingState = "create" | "update" | null;

export type PlanCrop = {
  id: string;
  name: string;
  variety: string;
};

export type PlanHarvest = {
  id: string;
  label: string;
  startDate: string | null;
  endDate: string | null;
};

export type ProductionPlan = {
  id: string;
  crop: PlanCrop | null;
  harvest: PlanHarvest | null;
  plantedArea: number;
  expectedYield: number;
  plannedPlantingDate: string | null;
  createdAt: string | null;
  /**
   * Versão do registro no servidor. É o que uma edição envia de volta como
   * `baseUpdatedAt` para que o servidor detecte alteração concorrente.
   */
  updatedAt: string | null;
  /** Preenchido só quando o registro ainda não foi aceito pela API. */
  pending: PendingState;
};

export type ProductionExecution = {
  id: string;
  productionPlanId: string;
  actualYield: number;
  harvestDate: string | null;
  /**
   * Onde o apontamento foi feito. Ausente quando o GPS não respondeu, estava
   * desligado ou teve a permissão negada — nada disso impede o registro.
   */
  latitude: number | null;
  longitude: number | null;
  createdAt: string | null;
  /** Ver `ProductionPlan.updatedAt`. */
  updatedAt: string | null;
  pending: PendingState;
};

export type ProductionComparison = {
  productionPlanId: string;
  expectedYield: number;
  totalActualYield: number;
  difference: number;
  percentageRealized: number;
};

// ----- Payloads -----

export type ProductionPlanCreatePayload = {
  harvestId: string;
  cropId: string;
  plantedArea: number;
  expectedYield: number;
  plannedPlantingDate?: string | null;
};

export type ProductionPlanUpdatePayload = {
  plantedArea: number;
  expectedYield: number;
  plannedPlantingDate?: string | null;
};

export type ProductionExecutionWritePayload = {
  actualYield: number;
  harvestDate: string;
  /**
   * Capturadas no momento em que o usuário salvou. Vão no corpo da requisição
   * e, por isso, ficam congeladas no item da fila: quando o despacho acontecer,
   * horas depois, a posição enviada continua sendo a do trabalho em campo — e
   * não a de onde o sinal de internet voltou.
   */
  latitude?: number | null;
  longitude?: number | null;
};

// ----- Respostas da API -----
//
// `plantedArea`, `expectedYield` etc. são BigDecimal no backend e podem
// chegar como string — o `num()` normaliza (mesma decisão do front web).

type PlanApiResponse = {
  id: string;
  crop: { id: string; name: string; variety: string } | null;
  harvest: {
    id: string;
    label: string;
    startDate: string | null;
    endDate: string | null;
  } | null;
  plantedArea: number | string;
  expectedYield: number | string;
  plannedPlantingDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ExecutionApiResponse = {
  id: string;
  productionPlanId: string;
  actualYield: number | string;
  harvestDate: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ComparisonApiResponse = {
  productionPlanId: string;
  expectedYield: number | string;
  totalActualYield: number | string;
  difference: number | string;
  percentageRealized: number | string;
};

/**
 * Como `num`, mas preserva a ausência. Zero é uma coordenada válida (o meridiano
 * de Greenwich, a linha do equador), então cair para 0 inventaria uma posição.
 */
function optionalNum(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapPlan(raw: PlanApiResponse): ProductionPlan {
  return {
    id: raw.id,
    crop: raw.crop
      ? { id: raw.crop.id, name: raw.crop.name, variety: raw.crop.variety }
      : null,
    harvest: raw.harvest
      ? {
          id: raw.harvest.id,
          label: raw.harvest.label,
          startDate: raw.harvest.startDate ?? null,
          endDate: raw.harvest.endDate ?? null,
        }
      : null,
    plantedArea: num(raw.plantedArea),
    expectedYield: num(raw.expectedYield),
    plannedPlantingDate: raw.plannedPlantingDate ?? null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    pending: null,
  };
}

function mapExecution(raw: ExecutionApiResponse): ProductionExecution {
  return {
    id: raw.id,
    productionPlanId: raw.productionPlanId,
    actualYield: num(raw.actualYield),
    harvestDate: raw.harvestDate ?? null,
    latitude: optionalNum(raw.latitude),
    longitude: optionalNum(raw.longitude),
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    pending: null,
  };
}

function mapComparison(raw: ComparisonApiResponse): ProductionComparison {
  return {
    productionPlanId: raw.productionPlanId,
    expectedYield: num(raw.expectedYield),
    totalActualYield: num(raw.totalActualYield),
    difference: num(raw.difference),
    percentageRealized: num(raw.percentageRealized),
  };
}

// ----- Leituras -----

export function fetchProductionPlans(
  farmerId: string,
): Promise<ProductionPlan[]> {
  return apiRequest<PlanApiResponse[]>(
    `/farmers/${farmerId}/production-plans`,
    { method: "GET" },
  ).then((list) => list.map(mapPlan));
}

export function fetchProductionPlan(planId: string): Promise<ProductionPlan> {
  return apiRequest<PlanApiResponse>(`/production-plans/${planId}`, {
    method: "GET",
  }).then(mapPlan);
}

export function fetchProductionExecutions(
  planId: string,
): Promise<ProductionExecution[]> {
  return apiRequest<ExecutionApiResponse[]>(
    `/production-plans/${planId}/executions`,
    { method: "GET" },
  ).then((list) => list.map(mapExecution));
}

export function fetchProductionComparison(
  planId: string,
): Promise<ProductionComparison> {
  return apiRequest<ComparisonApiResponse>(
    `/production-plans/${planId}/comparison`,
    { method: "GET" },
  ).then(mapComparison);
}

// ----- Mutações (online agora, ou fila offline) -----

export function createProductionPlan(
  farmerId: string,
  payload: ProductionPlanCreatePayload,
  display: { crop: PlanCrop | null; harvest: PlanHarvest | null },
): Promise<MutationResult<ProductionPlan>> {
  const localId = createLocalId();

  const snapshot: ProductionPlan = {
    id: localId,
    crop: display.crop,
    harvest: display.harvest,
    plantedArea: payload.plantedArea,
    expectedYield: payload.expectedYield,
    plannedPlantingDate: payload.plannedPlantingDate ?? null,
    createdAt: null,
    updatedAt: null,
    pending: "create",
  };

  return mutate<ProductionPlan>({
    request: () =>
      apiRequest<PlanApiResponse>(`/farmers/${farmerId}/production-plans`, {
        method: "POST",
        body: payload,
      }).then(mapPlan),
    queue: {
      id: localId,
      kind: "plan.create",
      method: "POST",
      path: `/farmers/${farmerId}/production-plans`,
      body: payload,
      label: `Novo plano — ${display.crop?.name ?? "cultura"} (${formatNumber(payload.plantedArea)} ha)`,
      snapshot,
      meta: { farmerId },
      invalidates: [CacheKeys.plans(farmerId)],
    },
  });
}

export function updateProductionPlan(
  plan: ProductionPlan,
  farmerId: string,
  payload: ProductionPlanUpdatePayload,
): Promise<MutationResult<ProductionPlan>> {
  const snapshot: ProductionPlan = {
    ...plan,
    plantedArea: payload.plantedArea,
    expectedYield: payload.expectedYield,
    plannedPlantingDate: payload.plannedPlantingDate ?? null,
    pending: "update",
  };

  // A versão que o usuário tinha em mãos ao abrir o formulário. Vai no corpo
  // para o servidor arbitrar e fica no item da fila para que o despacho, que
  // pode acontecer horas depois, continue comparando contra ela.
  const body = { ...payload, baseUpdatedAt: plan.updatedAt };

  return mutate<ProductionPlan>({
    request: () =>
      apiRequest<PlanApiResponse>(`/production-plans/${plan.id}`, {
        method: "PUT",
        body,
      }).then(mapPlan),
    queue: {
      kind: "plan.update",
      method: "PUT",
      path: `/production-plans/${plan.id}`,
      body,
      baseUpdatedAt: plan.updatedAt,
      label: `Editar plano — ${plan.crop?.name ?? "cultura"}`,
      snapshot,
      meta: { farmerId, planId: plan.id },
      invalidates: [CacheKeys.plans(farmerId), CacheKeys.plan(plan.id)],
    },
  });
}

export function deleteProductionPlan(
  plan: ProductionPlan,
  farmerId: string,
): Promise<MutationResult<void>> {
  return mutate<void>({
    request: () =>
      apiRequest<void>(`/production-plans/${plan.id}`, { method: "DELETE" }),
    queue: {
      kind: "plan.delete",
      method: "DELETE",
      path: `/production-plans/${plan.id}`,
      label: `Excluir plano — ${plan.crop?.name ?? "cultura"}`,
      meta: { farmerId, planId: plan.id },
      invalidates: [CacheKeys.plans(farmerId), CacheKeys.plan(plan.id)],
    },
  });
}

export function createProductionExecution(
  planId: string,
  payload: ProductionExecutionWritePayload,
): Promise<MutationResult<ProductionExecution>> {
  const localId = createLocalId();

  const snapshot: ProductionExecution = {
    id: localId,
    productionPlanId: planId,
    actualYield: payload.actualYield,
    harvestDate: payload.harvestDate,
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    createdAt: null,
    updatedAt: null,
    pending: "create",
  };

  return mutate<ProductionExecution>({
    request: () =>
      apiRequest<ExecutionApiResponse>(
        `/production-plans/${planId}/executions`,
        { method: "POST", body: payload },
      ).then(mapExecution),
    queue: {
      id: localId,
      kind: "execution.create",
      method: "POST",
      path: `/production-plans/${planId}/executions`,
      body: payload,
      label: `Apontamento de ${formatDate(payload.harvestDate)} — ${formatNumber(payload.actualYield)}`,
      snapshot,
      meta: { planId },
      invalidates: [CacheKeys.executions(planId), CacheKeys.comparison(planId)],
    },
  });
}

export function updateProductionExecution(
  execution: ProductionExecution,
  payload: ProductionExecutionWritePayload,
): Promise<MutationResult<ProductionExecution>> {
  const planId = execution.productionPlanId;

  const snapshot: ProductionExecution = {
    ...execution,
    actualYield: payload.actualYield,
    harvestDate: payload.harvestDate,
    // Edição sem GPS preserva a posição já registrada, como no backend.
    latitude: payload.latitude ?? execution.latitude,
    longitude: payload.longitude ?? execution.longitude,
    pending: "update",
  };

  const body = { ...payload, baseUpdatedAt: execution.updatedAt };

  return mutate<ProductionExecution>({
    request: () =>
      apiRequest<ExecutionApiResponse>(
        `/production-executions/${execution.id}`,
        { method: "PUT", body },
      ).then(mapExecution),
    queue: {
      kind: "execution.update",
      method: "PUT",
      path: `/production-executions/${execution.id}`,
      body,
      baseUpdatedAt: execution.updatedAt,
      label: `Editar apontamento de ${formatDate(payload.harvestDate)}`,
      snapshot,
      meta: { planId, executionId: execution.id },
      invalidates: [CacheKeys.executions(planId), CacheKeys.comparison(planId)],
    },
  });
}

export function deleteProductionExecution(
  execution: ProductionExecution,
): Promise<MutationResult<void>> {
  const planId = execution.productionPlanId;

  return mutate<void>({
    request: () =>
      apiRequest<void>(`/production-executions/${execution.id}`, {
        method: "DELETE",
      }),
    queue: {
      kind: "execution.delete",
      method: "DELETE",
      path: `/production-executions/${execution.id}`,
      label: `Excluir apontamento de ${formatDate(execution.harvestDate)}`,
      meta: { planId, executionId: execution.id },
      invalidates: [CacheKeys.executions(planId), CacheKeys.comparison(planId)],
    },
  });
}

// ----- Sobreposição do que está na fila -----
//
// O cache guarda o que a API devolveu; a fila guarda o que o usuário fez
// desde então. As telas precisam ver os dois juntos, senão um apontamento
// registrado no campo "some" até o celular achar sinal.

export function overlayPlans(
  farmerId: string,
  cached: ProductionPlan[],
  entries: OutboxEntry[],
): ProductionPlan[] {
  // `plan.update`/`plan.delete` também gravam `farmerId` em `meta`, então
  // um filtro só cobre criação, edição e exclusão.
  const pending = entries.filter(
    (entry) => entry.meta.farmerId === farmerId,
  );

  let result = [...cached];

  for (const entry of pending) {
    if (entry.kind === "plan.create" && entry.snapshot) {
      result = [entry.snapshot as ProductionPlan, ...result];
      continue;
    }

    if (entry.kind === "plan.update" && entry.snapshot) {
      const updated = entry.snapshot as ProductionPlan;
      result = result.map((plan) => (plan.id === updated.id ? updated : plan));
      continue;
    }

    if (entry.kind === "plan.delete") {
      result = result.filter((plan) => plan.id !== entry.meta.planId);
    }
  }

  return result;
}

export function overlayExecutions(
  planId: string,
  cached: ProductionExecution[],
  entries: OutboxEntry[],
): ProductionExecution[] {
  const pending = entries.filter((entry) => entry.meta.planId === planId);
  let result = [...cached];

  for (const entry of pending) {
    if (entry.kind === "execution.create" && entry.snapshot) {
      result = [...result, entry.snapshot as ProductionExecution];
      continue;
    }

    if (entry.kind === "execution.update" && entry.snapshot) {
      const updated = entry.snapshot as ProductionExecution;
      result = result.map((item) => (item.id === updated.id ? updated : item));
      continue;
    }

    if (entry.kind === "execution.delete") {
      result = result.filter((item) => item.id !== entry.meta.executionId);
    }
  }

  return result.sort((a, b) =>
    (b.harvestDate ?? "").localeCompare(a.harvestDate ?? ""),
  );
}

/**
 * Recalcula previsto x realizado localmente.
 *
 * `GET /comparison` só conhece o que já chegou ao servidor. Offline (ou com
 * apontamentos na fila) o número certo é o que inclui a fila — é ele que o
 * agricultor acabou de registrar.
 */
export function computeComparison(
  plan: ProductionPlan,
  executions: ProductionExecution[],
): ProductionComparison {
  const totalActualYield = executions.reduce(
    (total, execution) => total + execution.actualYield,
    0,
  );

  const expectedYield = plan.expectedYield;
  const difference = totalActualYield - expectedYield;
  const percentageRealized =
    expectedYield > 0 ? (totalActualYield / expectedYield) * 100 : 0;

  return {
    productionPlanId: plan.id,
    expectedYield,
    totalActualYield,
    difference,
    percentageRealized,
  };
}

/** Plano ainda não aceito pela API não tem id real — não aceita filho. */
export function canReceiveExecutions(plan: ProductionPlan): boolean {
  return !isLocalId(plan.id);
}

// ----- Reconciliação de conflito -----

/**
 * Grava localmente a versão que o servidor devolveu junto de um 409.
 *
 * Registrado na fila por `setConflictReconciler` no boot: a fila detecta o
 * conflito, mas quem sabe interpretar o corpo de um plano ou de um apontamento
 * é o domínio. A tela é avisada pela invalidação que o próprio despacho dispara.
 */
export async function reconcileProductionConflict(
  entry: OutboxEntry,
  serverVersion: unknown,
): Promise<void> {
  if (entry.kind.startsWith("plan.")) {
    const plan = mapPlan(serverVersion as PlanApiResponse);
    await writeCache(CacheKeys.plan(plan.id), plan);
    return;
  }

  if (entry.kind.startsWith("execution.")) {
    const execution = mapExecution(serverVersion as ExecutionApiResponse);
    const key = CacheKeys.executions(execution.productionPlanId);

    // A tela lê a lista de apontamentos, não o apontamento isolado: trocar o
    // item dentro da lista é o que faz a correção aparecer.
    const cached = await readCache<ProductionExecution[]>(key);
    if (!cached) return;

    const atualizada = cached.data.map((item) =>
      item.id === execution.id ? execution : item,
    );
    await writeCache(key, atualizada);
  }
}
