import { apiRequest } from "@/lib/api";

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

export function producerDisplayName(producer: Producer): string {
  return producer.aliasName ?? producer.user?.fullName ?? "Produtor sem nome";
}
