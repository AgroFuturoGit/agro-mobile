import type { Role } from "@/domain/auth";
import { apiRequest } from "@/lib/api";
import { CacheKeys } from "@/lib/cache";

export type OrganizationType = "COOP" | "ASSOC";

export const ORGANIZATION_TYPE_LABELS: Record<OrganizationType, string> = {
  COOP: "Cooperativa",
  ASSOC: "Associação",
};

export type Organization = {
  id: string;
  name: string;
  taxId: string;
  type: OrganizationType;
};

export type Farmer = {
  id: string;
  aliasName: string | null;
  isCompliant: boolean | null;
  user: {
    id: string;
    fullName: string;
    email: string;
    cpf: string;
  } | null;
  community: {
    id: string;
    name: string;
    organization: Organization | null;
  } | null;
};

type OrganizationApiResponse = {
  id: string;
  name: string;
  taxId: string;
  type: OrganizationType;
};

type FarmerApiResponse = {
  id: string;
  aliasName: string | null;
  isCompliant: boolean | null;
  user: {
    id: string;
    fullName: string;
    email: string;
    cpf: string;
  } | null;
  community: {
    id: string;
    name: string;
    organization: OrganizationApiResponse | null;
  } | null;
};

function mapFarmer(raw: FarmerApiResponse): Farmer {
  return {
    id: raw.id,
    aliasName: raw.aliasName ?? null,
    isCompliant: raw.isCompliant ?? null,
    user: raw.user
      ? {
          id: raw.user.id,
          fullName: raw.user.fullName,
          email: raw.user.email,
          cpf: raw.user.cpf,
        }
      : null,
    community: raw.community
      ? {
          id: raw.community.id,
          name: raw.community.name,
          organization: raw.community.organization
            ? {
                id: raw.community.organization.id,
                name: raw.community.organization.name,
                taxId: raw.community.organization.taxId,
                type: raw.community.organization.type,
              }
            : null,
        }
      : null,
  };
}

/** `GET /farmers/me` — exclusivo do perfil FARMER. */
export function fetchMyFarmer(): Promise<Farmer> {
  return apiRequest<FarmerApiResponse>("/farmers/me", {
    method: "GET",
  }).then(mapFarmer);
}

/** `GET /farmers` — exige ADMIN ou MANAGER no backend. */
export function fetchFarmers(communityId?: string): Promise<Farmer[]> {
  const query = communityId
    ? `?communityId=${encodeURIComponent(communityId)}`
    : "";
  return apiRequest<FarmerApiResponse[]>(`/farmers${query}`, {
    method: "GET",
  }).then((list) => list.map(mapFarmer));
}

/**
 * `GET /technicians/me/farmers` — agricultores atribuídos ao TECHNICIAN
 * autenticado, via a relação N:N `TechnicalAssistance`. É a única rota de
 * descoberta que o perfil Técnico tem: `GET /farmers` exige ADMIN/MANAGER e
 * `GET /farmers/me` é exclusivo de FARMER.
 */
export function fetchAssignedFarmers(): Promise<Farmer[]> {
  return apiRequest<FarmerApiResponse[]>("/technicians/me/farmers", {
    method: "GET",
  }).then((list) => list.map(mapFarmer));
}

export type FarmerDiscovery = {
  /** Chave de cache — separada por papel, porque o conjunto visível difere. */
  cacheKey: string;
  fetch: () => Promise<Farmer[]>;
};

/**
 * Como cada papel descobre os agricultores que pode ver.
 *
 * O backend não tem uma rota única: ADMIN e MANAGER listam por `/farmers`,
 * o TECHNICIAN só alcança os que lhe foram atribuídos. Concentrar a escolha
 * aqui evita que a tela precise conhecer as regras de `@PreAuthorize`.
 *
 * FARMER não passa por aqui — cai direto nos próprios planos via
 * `fetchMyFarmer`. `null` significa "este papel não seleciona agricultor".
 */
export function farmerDiscoveryFor(
  role: Role | null | undefined,
): FarmerDiscovery | null {
  switch (role) {
    case "ADMIN":
    case "MANAGER":
      return {
        cacheKey: CacheKeys.farmers(),
        fetch: () => fetchFarmers(),
      };
    case "TECHNICIAN":
      return {
        cacheKey: CacheKeys.assignedFarmers,
        fetch: fetchAssignedFarmers,
      };
    default:
      return null;
  }
}

export function farmerDisplayName(farmer: Farmer): string {
  return farmer.aliasName ?? farmer.user?.fullName ?? "Agricultor sem nome";
}
