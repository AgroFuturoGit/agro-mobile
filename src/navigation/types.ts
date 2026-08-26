import type { NavigatorScreenParams } from "@react-navigation/native";

import type { ProductionExecution, ProductionPlan } from "@/domain/production";

export type AuthStackParamList = {
  Login: undefined;
};

export type PlansStackParamList = {
  /** Escolha do produtor — só aparece para ADMIN/MANAGER/TECHNICIAN. */
  ProducerPicker: undefined;
  Plans: { producerId: string; producerName: string } | undefined;
  PlanDetail: {
    planId: string;
    producerId: string;
    producerName: string;
  };
};

export type TabsParamList = {
  PlansTab: NavigatorScreenParams<PlansStackParamList>;
  SyncTab: undefined;
  ProfileTab: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabsParamList>;
  /**
   * Formulários entram como modal a partir de qualquer aba. As entidades são
   * passadas inteiras (JSON puro) para que a edição funcione offline, sem
   * depender de uma releitura da API.
   */
  PlanForm: { producerId: string; plan?: ProductionPlan };
  ExecutionForm: { plan: ProductionPlan; execution?: ProductionExecution };
  Reauth: undefined;
};

declare global {
  namespace ReactNavigation {
    // Interface vazia de propósito: é assim que o React Navigation espera a
    // augmentação da lista de rotas raiz.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
