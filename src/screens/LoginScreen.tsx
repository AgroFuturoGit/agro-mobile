import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  Button,
  Dialog,
  HelperText,
  Portal,
  Text,
  TextInput,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/contexts/AuthContext";
import { useSync } from "@/contexts/SyncContext";
import { loginSchema } from "@/domain/auth";
import {
  ApiError,
  getApiBaseUrl,
  getDefaultApiBaseUrl,
  isOfflineError,
  setApiBaseUrl,
} from "@/lib/api";
import { brand, spacing } from "@/theme";

type Props = {
  /** `reauth` roda com o app já aberto, só para renovar o token. */
  mode?: "initial" | "reauth";
  onSuccess?: () => void;
  onCancel?: () => void;
};

export function LoginScreen({ mode = "initial", onSuccess, onCancel }: Props) {
  const { signIn } = useAuth();
  const { online, pendingCount, sync } = useSync();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  // O endereço da API também é editável aqui, não só no Perfil.
  //
  // Num APK standalone o `hostUri` do Expo não existe, então a detecção
  // automática cai no `localhost` — que no celular é o próprio aparelho. Sem
  // este campo o usuário não conseguiria entrar nem chegar ao Perfil, que
  // fica atrás do login: ficaria preso sem nenhuma saída pela interface.
  const [serverDialog, setServerDialog] = useState(false);
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl());
  const [currentUrl, setCurrentUrl] = useState(getApiBaseUrl());

  async function handleSaveServer() {
    const saved = await setApiBaseUrl(serverUrl);
    setCurrentUrl(saved);
    setServerUrl(saved);
    setServerDialog(false);
    setFormError(null);
  }

  async function handleResetServer() {
    const saved = await setApiBaseUrl(null);
    setCurrentUrl(saved);
    setServerUrl(saved);
    setServerDialog(false);
    setFormError(null);
  }

  async function handleSubmit() {
    setFormError(null);
    setFieldErrors({});

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        email: flat.email?.[0],
        password: flat.password?.[0],
      });
      return;
    }

    setSubmitting(true);
    try {
      await signIn(parsed.data);
      // Entrou com token novo: é a hora de subir o que ficou na fila.
      if (pendingCount > 0) void sync();
      onSuccess?.();
    } catch (error) {
      if (isOfflineError(error)) {
        setFormError(
          "Sem conexão com o servidor. O primeiro acesso precisa de internet.",
        );
      } else if (error instanceof ApiError) {
        setFormError(
          error.status === 401 || error.status === 403
            ? "E-mail ou senha incorretos."
            : error.message,
        );
      } else {
        setFormError("Não foi possível entrar. Tente novamente.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.logo}>
              <MaterialCommunityIcons name="sprout" size={28} color="#FFFFFF" />
            </View>
            <Text variant="headlineSmall" style={styles.brandName}>
              ProduPlan Campo
            </Text>
            <Text variant="bodyMedium" style={styles.muted}>
              {mode === "reauth"
                ? "Entre novamente para sincronizar os registros guardados no aparelho."
                : "Planejamento e apontamento de produção — funciona sem sinal."}
            </Text>
          </View>

          {!online ? (
            <View style={styles.offlineNotice}>
              <MaterialCommunityIcons
                name="cloud-off-outline"
                size={18}
                color={brand.muted}
              />
              <Text variant="bodySmall" style={styles.muted}>
                Você está offline. Conecte-se para entrar.
              </Text>
            </View>
          ) : null}

          {formError ? (
            <View style={styles.errorBox}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={18}
                color={brand.danger}
              />
              <Text variant="bodySmall" style={styles.errorText}>
                {formError}
              </Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <View>
              <TextInput
                label="E-mail"
                value={email}
                onChangeText={setEmail}
                mode="outlined"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                left={<TextInput.Icon icon="email-outline" />}
                error={Boolean(fieldErrors.email)}
                disabled={submitting}
              />
              {fieldErrors.email ? (
                <HelperText type="error" visible>
                  {fieldErrors.email}
                </HelperText>
              ) : null}
            </View>

            <View>
              <TextInput
                label="Senha"
                value={password}
                onChangeText={setPassword}
                mode="outlined"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="current-password"
                left={<TextInput.Icon icon="lock-outline" />}
                right={
                  <TextInput.Icon
                    icon={showPassword ? "eye-off-outline" : "eye-outline"}
                    onPress={() => setShowPassword((value) => !value)}
                    accessibilityLabel={
                      showPassword ? "Ocultar senha" : "Mostrar senha"
                    }
                  />
                }
                error={Boolean(fieldErrors.password)}
                disabled={submitting}
                onSubmitEditing={handleSubmit}
              />
              {fieldErrors.password ? (
                <HelperText type="error" visible>
                  {fieldErrors.password}
                </HelperText>
              ) : null}
            </View>

            <Button
              mode="contained"
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
              style={styles.submit}
              contentStyle={styles.submitContent}
            >
              {submitting ? "Entrando..." : "Entrar"}
            </Button>

            {mode === "reauth" && onCancel ? (
              <Button mode="text" onPress={onCancel} disabled={submitting}>
                Continuar offline
              </Button>
            ) : null}
          </View>

          <Button
            mode="text"
            icon="server-network"
            compact
            disabled={submitting}
            onPress={() => {
              setServerUrl(currentUrl);
              setServerDialog(true);
            }}
            labelStyle={styles.serverLabel}
          >
            {currentUrl}
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>

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
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.0.10:8080"
            />
            <Text variant="bodySmall" style={styles.muted}>
              Peça ao responsável o endereço do servidor da sua cooperativa.
              Padrão detectado: {getDefaultApiBaseUrl()}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={handleResetServer}>Restaurar padrão</Button>
            <Button onPress={handleSaveServer}>Salvar</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: brand.surface },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.xl,
  },
  header: { alignItems: "center", gap: spacing.sm },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: brand.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: { fontWeight: "700" },
  muted: { color: brand.muted, textAlign: "center" },
  offlineNotice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: "#F1F5F9",
    padding: spacing.md,
    borderRadius: 10,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: brand.dangerLight,
    padding: spacing.md,
    borderRadius: 10,
  },
  errorText: { color: brand.danger, flex: 1 },
  form: { gap: spacing.md },
  submit: { marginTop: spacing.sm, borderRadius: 10 },
  submitContent: { paddingVertical: spacing.xs },
  serverLabel: { fontSize: 12, color: brand.muted },
  dialogContent: { gap: spacing.sm },
});
