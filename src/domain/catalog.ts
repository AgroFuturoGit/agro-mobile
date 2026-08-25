import { apiRequest } from "@/lib/api";

/**
 * Cadastros de apoio (culturas e safras) usados para montar um plano de
 * produção. São listas pequenas e estáveis — ficam em cache para que dê para
 * criar plano sem sinal.
 */

export type Crop = {
  id: string;
  name: string;
  variety: string;
  isPriority: boolean;
};

export type Harvest = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
};

type CropApiResponse = {
  id: string;
  name: string;
  variety: string;
  isPriority: boolean;
};

type HarvestApiResponse = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
};

export function fetchCrops(): Promise<Crop[]> {
  return apiRequest<CropApiResponse[]>("/crops", { method: "GET" }).then(
    (list) =>
      list.map((raw) => ({
        id: raw.id,
        name: raw.name,
        variety: raw.variety,
        isPriority: raw.isPriority,
      })),
  );
}

export function fetchHarvests(): Promise<Harvest[]> {
  return apiRequest<HarvestApiResponse[]>("/harvests", { method: "GET" }).then(
    (list) =>
      list.map((raw) => ({
        id: raw.id,
        label: raw.label,
        startDate: raw.startDate,
        endDate: raw.endDate,
      })),
  );
}

/** Aceita tanto `Crop` quanto a cultura embutida num plano (`PlanCrop`). */
export function cropLabel(crop: { name: string; variety: string }): string {
  return crop.variety ? `${crop.name} — ${crop.variety}` : crop.name;
}
