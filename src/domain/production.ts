import { apiRequest } from "@/lib/api";
import { CacheKeys } from "@/lib/cache";
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
  /** Preenchido só quando o registro ainda não foi aceito pela API. */
  pending: PendingState;
};

export type ProductionExecution = {
  id: string;
  productionPlanId: string;
  actualYield: number;
  harvestDate: string | null;
  createdAt: string | null;
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
};

type ExecutionApiResponse = {
  id: string;
  productionPlanId: string;
  actualYield: number | string;
  harvestDate: string | null;
  createdAt: string | null;
};

type ComparisonApiResponse = {
  productionPlanId: string;
  expectedYield: number | string;
  totalActualYield: number | string;
  difference: number | string;
  percentageRealized: number | string;
};

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
    pending: null,
  };
}

function mapExecution(raw: ExecutionApiResponse): ProductionExecution {
  return {
    id: raw.id,
    productionPlanId: raw.productionPlanId,
    actualYield: num(raw.actualYield),
    harvestDate: raw.harvestDate ?? null,
    createdAt: raw.createdAt ?? null,
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
  producerId: string,
): Promise<ProductionPlan[]> {
  return apiRequest<PlanApiResponse[]>(
    `/producers/${producerId}/production-plans`,
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
  producerId: string,
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
    pending: "create",
  };

  return mutate<ProductionPlan>({
    request: () =>
      apiRequest<PlanApiResponse>(`/producers/${producerId}/production-plans`, {
        method: "POST",
        body: payload,
      }).then(mapPlan),
    queue: {
      id: localId,
      kind: "plan.create",
      method: "POST",
      path: `/producers/${producerId}/production-plans`,
      body: payload,
      label: `Novo plano — ${display.crop?.name ?? "cultura"} (${formatNumber(payload.plantedArea)} ha)`,
      snapshot,
      meta: { producerId },
      invalidates: [CacheKeys.plans(producerId)],
    },
  });
}

export function updateProductionPlan(
  plan: ProductionPlan,
  producerId: string,
  payload: ProductionPlanUpdatePayload,
): Promise<MutationResult<ProductionPlan>> {
  const snapshot: ProductionPlan = {
    ...plan,
    plantedArea: payload.plantedArea,
    expectedYield: payload.expectedYield,
    plannedPlantingDate: payload.plannedPlantingDate ?? null,
    pending: "update",
  };

  return mutate<ProductionPlan>({
    request: () =>
      apiRequest<PlanApiResponse>(`/production-plans/${plan.id}`, {
        method: "PUT",
        body: payload,
      }).then(mapPlan),
    queue: {
      kind: "plan.update",
      method: "PUT",
      path: `/production-plans/${plan.id}`,
      body: payload,
      label: `Editar plano — ${plan.crop?.name ?? "cultura"}`,
      snapshot,
      meta: { producerId, planId: plan.id },
      invalidates: [CacheKeys.plans(producerId), CacheKeys.plan(plan.id)],
    },
  });
}

export function deleteProductionPlan(
  plan: ProductionPlan,
  producerId: string,
): Promise<MutationResult<void>> {
  return mutate<void>({
    request: () =>
      apiRequest<void>(`/production-plans/${plan.id}`, { method: "DELETE" }),
    queue: {
      kind: "plan.delete",
      method: "DELETE",
      path: `/production-plans/${plan.id}`,
      label: `Excluir plano — ${plan.crop?.name ?? "cultura"}`,
      meta: { producerId, planId: plan.id },
      invalidates: [CacheKeys.plans(producerId), CacheKeys.plan(plan.id)],
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
    createdAt: null,
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
    pending: "update",
  };

  return mutate<ProductionExecution>({
    request: () =>
      apiRequest<ExecutionApiResponse>(
        `/production-executions/${execution.id}`,
        { method: "PUT", body: payload },
      ).then(mapExecution),
    queue: {
      kind: "execution.update",
      method: "PUT",
      path: `/production-executions/${execution.id}`,
      body: payload,
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
  producerId: string,
  cached: ProductionPlan[],
  entries: OutboxEntry[],
): ProductionPlan[] {
  // `plan.update`/`plan.delete` também gravam `producerId` em `meta`, então
  // um filtro só cobre criação, edição e exclusão.
  const pending = entries.filter(
    (entry) => entry.meta.producerId === producerId,
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
 * produtor acabou de registrar.
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
