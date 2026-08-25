import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  Button,
  Card,
  Dialog,
  Divider,
  List,
  Portal,
  Snackbar,
  Text,
  TextInput,
} from "react-native-paper";

import { useAuth } from "@/contexts/AuthContext";
import { useSync } from "@/contexts/SyncContext";
import { ROLE_LABELS } from "@/domain/auth";
import {
  getApiBaseUrl,
  getDefaultApiBaseUrl,
  setApiBaseUrl,
} from "@/lib/api";
import { formatCpf } from "@/lib/format";
import { clearCache } from "@/lib/storage";
import type { RootStackParamList } from "@/navigation/types";
import { brand, spacing } from "@/theme";

export function ProfileScreen() {
  const { user, sessionExpired, signOut } = useAuth();
  const { pendingCount, online } = useSync();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [serverDialog, setServerDialog] = useState(false);
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl());
  const [currentUrl, setCurrentUrl] = useState(getApiBaseUrl());
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function handleSaveServer() {
    const saved = await setApiBaseUrl(serverUrl);
    setCurrentUrl(saved);
    setServerUrl(saved);
    setServerDialog(false);
    setToast(`Servidor definido para ${saved}`);
  }

  async function handleResetServer() {
    const saved = await setApiBaseUrl(null);
    setCurrentUrl(saved);
    setServerUrl(saved);
    setServerDialog(false);
    setToast(`Servidor restaurado para ${saved}`);
  }

  async function handleClearCache() {
    await clearCache();
    setToast("Dados em cache apagados. A fila de envio foi preservada.");
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card mode="outlined" style={styles.card}>
          <Card.Content style={styles.identity}>
            <View style={styles.avatar}>
              <MaterialCommunityIcons
                name="account"
                size={28}
                color={brand.primary}
              />
            </View>
            <View style={styles.flex}>
              <Text variant="titleMedium" style={styles.bold}>
                {user?.fullName ?? "—"}
              </Text>
              <Text variant="bodySmall" style={styles.muted}>
                {user?.email ?? "—"}
              </Text>
              <Text variant="bodySmall" style={styles.role}>
                {user ? ROLE_LABELS[user.role] : "—"}
              </Text>
            </View>
          </Card.Content>
        </Card>

        {sessionExpired ? (
          <Card mode="outlined" style={[styles.card, styles.warningCard]}>
            <Card.Content style={styles.warningContent}>
              <Text variant="bodyMedium" style={styles.warningText}>
                Sua sessão expirou. Entre novamente para voltar a sincronizar
                com o servidor.
              </Text>
              <Button
                mode="contained"
                onPress={() => navigation.navigate("Reauth")}
              >
                Entrar novamente
              </Button>
            </Card.Content>
          </Card>
        ) : null}

        <Card mode="outlined" style={styles.card}>
          <List.Item
            title="CPF"
            description={formatCpf(user?.cpf)}
            left={(props) => <List.Icon {...props} icon="card-account-details-outline" />}
          />
          <Divider />
          <List.Item
            title="Servidor"
            description={currentUrl}
            left={(props) => <List.Icon {...props} icon="server-network" />}
            right={(props) => <List.Icon {...props} icon="pencil-outline" />}
            onPress={() => {
              setServerUrl(currentUrl);
              setServerDialog(true);
            }}
          />
          <Divider />
          <List.Item
            title="Conexão"
            description={online ? "Online" : "Offline"}
            left={(props) => (
              <List.Icon
                {...props}
                icon={online ? "wifi" : "wifi-off"}
                color={online ? brand.primary : brand.muted}
              />
            )}
          />
          <Divider />
          <List.Item
            title="Limpar dados em cache"
            description="Mantém a fila de envio intacta"
            left={(props) => <List.Icon {...props} icon="broom" />}
            onPress={handleClearCache}
          />
        </Card>

        <Button
          mode="outlined"
          icon="logout"
          textColor={brand.danger}
          onPress={() => setConfirmSignOut(true)}
          style={styles.signOut}
        >
          Sair da conta
        </Button>

        <Text variant="bodySmall" style={styles.footer}>
          ProduPlan Campo · consome a API agro-backend
        </Text>
      </ScrollView>

      <Portal>
        <Dialog visible={serverDialog} onDismiss={() => setServerDialog(false)}>
          <Dialog.Title>Endereço do servidor</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            <TextInput
              label="URL da API"
              value={serverUrl}
              onChangeText={setServerUrl}
              mode="outlined"
              autoCapitalize="none"
              keyboardType="url"
              placeholder="http://192.168.0.10:8080"
            />
            <Text variant="bodySmall" style={styles.muted}>
              Padrão detectado: {getDefaultApiBaseUrl()}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={handleResetServer}>Restaurar padrão</Button>
            <Button onPress={handleSaveServer}>Salvar</Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog
          visible={confirmSignOut}
          onDismiss={() => setConfirmSignOut(false)}
        >
          <Dialog.Title>Sair da conta</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {pendingCount > 0
                ? `Há ${pendingCount} ${pendingCount === 1 ? "registro" : "registros"} na fila de envio. A fila continua salva no aparelho e sobe quando você entrar de novo.`
                : "Os dados em cache serão apagados deste aparelho."}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmSignOut(false)}>Cancelar</Button>
            <Button
              textColor={brand.danger}
              onPress={() => {
                setConfirmSignOut(false);
                void signOut();
              }}
            >
              Sair
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={toast !== null}
        onDismiss={() => setToast(null)}
        duration={4000}
      >
        {toast ?? ""}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.background },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: brand.surface, borderColor: brand.border },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: brand.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  flex: { flex: 1 },
  bold: { fontWeight: "600" },
  muted: { color: brand.muted },
  role: { color: brand.primary, fontWeight: "600", marginTop: 2 },
  warningCard: { backgroundColor: brand.warningLight, borderColor: brand.warningLight },
  warningContent: { gap: spacing.md },
  warningText: { color: brand.warning },
  signOut: { borderColor: brand.dangerLight },
  footer: { color: brand.muted, textAlign: "center", marginTop: spacing.lg },
  dialogContent: { gap: spacing.sm },
});
