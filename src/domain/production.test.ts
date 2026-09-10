import {
  canReceiveExecutions,
  computeComparison,
  overlayExecutions,
  overlayPlans,
  type ProductionExecution,
  type ProductionPlan,
} from "@/domain/production";
import type { OutboxEntry, OutboxKind } from "@/lib/outbox";

function plan(
  id: string,
  overrides: Partial<ProductionPlan> = {},
): ProductionPlan {
  return {
    id,
    crop: { id: "c1", name: "Milho", variety: "BR 106" },
    harvest: { id: "h1", label: "Safra 2026", startDate: null, endDate: null },
    plantedArea: 2,
    expectedYield: 100,
    updatedAt: null,
    plannedPlantingDate: "2026-03-01",
    createdAt: "2026-03-01",
    pending: null,
    ...overrides,
  };
}

function execution(
  id: string,
  overrides: Partial<ProductionExecution> = {},
): ProductionExecution {
  return {
    id,
    productionPlanId: "plan-1",
    actualYield: 30,
    harvestDate: "2026-08-01",
    latitude: null,
    longitude: null,
    updatedAt: null,
    createdAt: "2026-08-01",
    pending: null,
    ...overrides,
  };
}

function entry(
  kind: OutboxKind,
  meta: OutboxEntry["meta"],
  snapshot?: unknown,
  id = `local-${kind}`,
): OutboxEntry {
  return {
    id,
    kind,
    method: "POST",
    path: "/irrelevante",
    label: kind,
    snapshot,
    createdAt: 0,
    attempts: 0,
    lastError: null,
    status: "pending",
    meta,
    invalidates: [],
  };
}

describe("overlayPlans", () => {
  it("mostra o plano criado offline no topo da lista", () => {
    const pending = plan("local-1", { pending: "create" });

    const result = overlayPlans(
      "prod-1",
      [plan("plan-1")],
      [entry("plan.create", { farmerId: "prod-1" }, pending, "local-1")],
    );

    expect(result.map((item) => item.id)).toEqual(["local-1", "plan-1"]);
    expect(result[0]?.pending).toBe("create");
  });

  it("substitui o plano editado offline pela versão da fila", () => {
    const edited = plan("plan-1", { plantedArea: 9, pending: "update" });

    const result = overlayPlans(
      "prod-1",
      [plan("plan-1")],
      [
        entry(
          "plan.update",
          { farmerId: "prod-1", planId: "plan-1" },
          edited,
        ),
      ],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.plantedArea).toBe(9);
    expect(result[0]?.pending).toBe("update");
  });

  it("remove da lista o plano excluído offline", () => {
    const result = overlayPlans(
      "prod-1",
      [plan("plan-1"), plan("plan-2")],
      [entry("plan.delete", { farmerId: "prod-1", planId: "plan-1" })],
    );

    expect(result.map((item) => item.id)).toEqual(["plan-2"]);
  });

  it("ignora a fila de outro agricultor", () => {
    const other = plan("local-9", { pending: "create" });

    const result = overlayPlans(
      "prod-1",
      [plan("plan-1")],
      [entry("plan.create", { farmerId: "prod-2" }, other, "local-9")],
    );

    expect(result.map((item) => item.id)).toEqual(["plan-1"]);
  });

  it("não altera a lista quando a fila está vazia", () => {
    const cached = [plan("plan-1"), plan("plan-2")];

    expect(overlayPlans("prod-1", cached, [])).toEqual(cached);
  });
});

describe("overlayExecutions", () => {
  it("inclui o apontamento registrado offline", () => {
    const pending = execution("local-1", {
      pending: "create",
      actualYield: 12,
    });

    const result = overlayExecutions(
      "plan-1",
      [execution("exec-1")],
      [entry("execution.create", { planId: "plan-1" }, pending, "local-1")],
    );

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.id)).toContain("local-1");
  });

  it("substitui o apontamento editado offline", () => {
    const edited = execution("exec-1", { actualYield: 55, pending: "update" });

    const result = overlayExecutions(
      "plan-1",
      [execution("exec-1")],
      [
        entry(
          "execution.update",
          { planId: "plan-1", executionId: "exec-1" },
          edited,
        ),
      ],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.actualYield).toBe(55);
  });

  it("remove o apontamento excluído offline", () => {
    const result = overlayExecutions(
      "plan-1",
      [execution("exec-1"), execution("exec-2")],
      [
        entry("execution.delete", {
          planId: "plan-1",
          executionId: "exec-1",
        }),
      ],
    );

    expect(result.map((item) => item.id)).toEqual(["exec-2"]);
  });

  it("ordena da colheita mais recente para a mais antiga", () => {
    const result = overlayExecutions(
      "plan-1",
      [
        execution("antigo", { harvestDate: "2026-06-01" }),
        execution("recente", { harvestDate: "2026-09-01" }),
        execution("meio", { harvestDate: "2026-07-15" }),
      ],
      [],
    );

    expect(result.map((item) => item.id)).toEqual([
      "recente",
      "meio",
      "antigo",
    ]);
  });

  it("ignora a fila de outro plano", () => {
    const other = execution("local-9", { productionPlanId: "plan-2" });

    const result = overlayExecutions(
      "plan-1",
      [execution("exec-1")],
      [entry("execution.create", { planId: "plan-2" }, other, "local-9")],
    );

    expect(result.map((item) => item.id)).toEqual(["exec-1"]);
  });
});

describe("computeComparison", () => {
  /**
   * O `GET /comparison` do backend só conhece o que já chegou ao servidor.
   * Com apontamento na fila, o número certo é o que inclui a fila — é ele que
   * o agricultor acabou de registrar.
   */
  it("soma os apontamentos e calcula o percentual realizado", () => {
    const result = computeComparison(plan("plan-1", { expectedYield: 200 }), [
      execution("a", { actualYield: 60 }),
      execution("b", { actualYield: 40 }),
    ]);

    expect(result.totalActualYield).toBe(100);
    expect(result.expectedYield).toBe(200);
    expect(result.difference).toBe(-100);
    expect(result.percentageRealized).toBe(50);
  });

  it("aponta diferença positiva quando a colheita supera o previsto", () => {
    const result = computeComparison(plan("plan-1", { expectedYield: 100 }), [
      execution("a", { actualYield: 130 }),
    ]);

    expect(result.difference).toBe(30);
    expect(result.percentageRealized).toBe(130);
  });

  it("trata plano sem apontamento como zero realizado", () => {
    const result = computeComparison(
      plan("plan-1", { expectedYield: 100 }),
      [],
    );

    expect(result.totalActualYield).toBe(0);
    expect(result.percentageRealized).toBe(0);
    expect(result.difference).toBe(-100);
  });

  it("não divide por zero quando o previsto é zero", () => {
    const result = computeComparison(plan("plan-1", { expectedYield: 0 }), [
      execution("a", { actualYield: 10 }),
    ]);

    expect(result.percentageRealized).toBe(0);
    expect(Number.isFinite(result.percentageRealized)).toBe(true);
  });
});

describe("canReceiveExecutions", () => {
  it("recusa plano que ainda não foi aceito pela API", () => {
    // Sem id real não há como vincular o apontamento no backend.
    expect(canReceiveExecutions(plan("local-abc"))).toBe(false);
  });

  it("aceita plano já sincronizado", () => {
    expect(
      canReceiveExecutions(plan("d290f1ee-6c54-4b01-90e6-d701748f0851")),
    ).toBe(true);
  });
});
