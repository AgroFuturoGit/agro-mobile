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

export type Producer = {
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

type ProducerApiResponse = {
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

function mapProducer(raw: ProducerApiResponse): Producer {
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

/** `GET /producers/me` — exclusivo do perfil PRODUCER. */
export function fetchMyProducer(): Promise<Producer> {
  return apiRequest<ProducerApiResponse>("/producers/me", {
    method: "GET",
  }).then(mapProducer);
}

/** `GET /producers` — exige ADMIN ou MANAGER no backend. */
export function fetchProducers(communityId?: string): Promise<Producer[]> {
  const query = communityId
    ? `?communityId=${encodeURIComponent(communityId)}`
    : "";
  return apiRequest<ProducerApiResponse[]>(`/producers${query}`, {
    method: "GET",
  }).then((list) => list.map(mapProducer));
}

/**
 * `GET /technicians/me/producers` — produtores atribuídos ao TECHNICIAN
 * autenticado, via a relação N:N `TechnicalAssistance`. É a única rota de
 * descoberta que o perfil Técnico tem: `GET /producers` exige ADMIN/MANAGER e
 * `GET /producers/me` é exclusivo de PRODUCER.
 */
export function fetchAssignedProducers(): Promise<Producer[]> {
  return apiRequest<ProducerApiResponse[]>("/technicians/me/producers", {
    method: "GET",
  }).then((list) => list.map(mapProducer));
}

export type ProducerDiscovery = {
  /** Chave de cache — separada por papel, porque o conjunto visível difere. */
  cacheKey: string;
  fetch: () => Promise<Producer[]>;
};

/**
 * Como cada papel descobre os produtores que pode ver.
 *
 * O backend não tem uma rota única: ADMIN e MANAGER listam por `/producers`,
 * o TECHNICIAN só alcança os que lhe foram atribuídos. Concentrar a escolha
 * aqui evita que a tela precise conhecer as regras de `@PreAuthorize`.
 *
 * PRODUCER não passa por aqui — cai direto nos próprios planos via
 * `fetchMyProducer`. `null` significa "este papel não seleciona produtor".
 */
export function producerDiscoveryFor(
  role: Role | null | undefined,
): ProducerDiscovery | null {
  switch (role) {
    case "ADMIN":
    case "MANAGER":
      return {
        cacheKey: CacheKeys.producers(),
        fetch: () => fetchProducers(),
      };
    case "TECHNICIAN":
      return {
        cacheKey: CacheKeys.assignedProducers,
        fetch: fetchAssignedProducers,
      };
    default:
      return null;
  }
}

export function producerDisplayName(producer: Producer): string {
  return producer.aliasName ?? producer.user?.fullName ?? "Produtor sem nome";
}
