import { StyleSheet, View } from "react-native";

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, Text } from "react-native-paper";

import { useAuth } from "@/contexts/AuthContext";
import { useSync } from "@/contexts/SyncContext";
import { ExecutionFormScreen } from "@/screens/ExecutionFormScreen";
import { FarmerPickerScreen } from "@/screens/FarmerPickerScreen";
import { LoginScreen } from "@/screens/LoginScreen";
import { PlanDetailScreen } from "@/screens/PlanDetailScreen";
import { PlanFormScreen } from "@/screens/PlanFormScreen";
import { PlansScreen } from "@/screens/PlansScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { SyncScreen } from "@/screens/SyncScreen";
import { brand, spacing } from "@/theme";

import type {
  AuthStackParamList,
  PlansStackParamList,
  RootStackParamList,
  TabsParamList,
} from "./types";

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const Tabs = createBottomTabNavigator<TabsParamList>();
const PlansStack = createNativeStackNavigator<PlansStackParamList>();

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: brand.primary,
    background: brand.background,
    card: brand.surface,
    border: brand.border,
  },
};

function PlansNavigator() {
  const { user } = useAuth();

  // FARMER cai direto nos próprios planos (`/farmers/me`); os outros
  // perfis precisam escolher o agricultor antes.
  const initialRouteName =
    user?.role === "FARMER"
      ? ("Plans" as const)
      : ("FarmerPicker" as const);

  return (
    <PlansStack.Navigator initialRouteName={initialRouteName}>
      <PlansStack.Screen
        name="FarmerPicker"
        component={FarmerPickerScreen}
        options={{ title: "Agricultores" }}
      />
      <PlansStack.Screen
        name="Plans"
        component={PlansScreen}
        options={{ title: "Planos de produção" }}
      />
      <PlansStack.Screen
        name="PlanDetail"
        component={PlanDetailScreen}
        options={{ title: "Plano" }}
      />
    </PlansStack.Navigator>
  );
}

function TabsNavigator() {
  const { pendingCount, failedCount } = useSync();
  const queued = pendingCount + failedCount;

  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: brand.primary,
        tabBarInactiveTintColor: brand.muted,
      }}
    >
      <Tabs.Screen
        name="PlansTab"
        component={PlansNavigator}
        options={{
          title: "Planos",
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="sprout" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="SyncTab"
        component={SyncScreen}
        options={{
          title: "Sincronização",
          headerShown: true,
          tabBarBadge: queued > 0 ? queued : undefined,
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="cloud-sync-outline"
              color={color}
              size={size}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          title: "Perfil",
          headerShown: true,
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons
              name="account-outline"
              color={color}
              size={size}
            />
          ),
        }}
      />
    </Tabs.Navigator>
  );
}

/** Login apresentado como modal para renovar a sessão sem sair do app. */
function ReauthScreen({ navigation }: { navigation: { goBack: () => void } }) {
  return (
    <LoginScreen
      mode="reauth"
      onSuccess={navigation.goBack}
      onCancel={navigation.goBack}
    />
  );
}

function LoginRootScreen() {
  return <LoginScreen />;
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginRootScreen} />
    </AuthStack.Navigator>
  );
}

function BootSplash() {
  return (
    <View style={styles.splash}>
      <View style={styles.logo}>
        <MaterialCommunityIcons name="sprout" size={28} color="#FFFFFF" />
      </View>
      <Text variant="titleMedium">ProduPlan Campo</Text>
      <ActivityIndicator />
    </View>
  );
}

export function RootNavigator() {
  const { status } = useAuth();

  if (status === "loading") return <BootSplash />;

  return (
    <NavigationContainer theme={navigationTheme}>
      {status === "signed-out" ? (
        <AuthNavigator />
      ) : (
        <RootStack.Navigator>
          <RootStack.Screen
            name="Tabs"
            component={TabsNavigator}
            options={{ headerShown: false }}
          />
          <RootStack.Group
            screenOptions={{ presentation: "modal", headerShown: false }}
          >
            <RootStack.Screen name="PlanForm" component={PlanFormScreen} />
            <RootStack.Screen
              name="ExecutionForm"
              component={ExecutionFormScreen}
            />
            <RootStack.Screen name="Reauth" component={ReauthScreen} />
          </RootStack.Group>
        </RootStack.Navigator>
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    backgroundColor: brand.surface,
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: brand.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
