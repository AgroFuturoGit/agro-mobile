import type { NavigatorScreenParams } from "@react-navigation/native";

import type { ProductionExecution, ProductionPlan } from "@/domain/production";

export type AuthStackParamList = {
  Login: undefined;
};

export type PlansStackParamList = {
  /** Escolha do agricultor — só aparece para ADMIN/MANAGER/TECHNICIAN. */
  FarmerPicker: undefined;
  Plans: { farmerId: string; farmerName: string } | undefined;
  PlanDetail: {
    planId: string;
    farmerId: string;
    farmerName: string;
  };
};

export type TabsParamList = {
  PlansTab: NavigatorScreenParams<PlansStackParamList>;
  SyncTab: undefined;
  ProfileTab: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabsParamList>;
  // Entidades vão inteiras na rota para que a edição funcione offline, sem
  // depender de releitura da API.
  PlanForm: { farmerId: string; plan?: ProductionPlan };
  ExecutionForm: { plan: ProductionPlan; execution?: ProductionExecution };
  Reauth: undefined;
};

declare global {
  namespace ReactNavigation {
    // Vazia de propósito: é como o React Navigation espera a augmentação.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
