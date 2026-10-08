import { useRef, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, View } from "react-native";

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ActivityIndicator, Button, IconButton, Text } from "react-native-paper";

import {
  type Attachment,
  MAX_ATTACHMENTS_PER_EXECUTION,
  persistCapturedPhoto,
} from "@/lib/attachments";
import { brand, spacing } from "@/theme";

type Props = {
  attachments: Attachment[];
  onAdd: (attachment: Attachment) => void;
  onRemove: (attachment: Attachment) => void;
  disabled?: boolean;
};

/**
 * Captura de comprovações fotográficas do apontamento.
 *
 * A permissão de câmera é pedida no toque do botão, não na abertura da tela:
 * quem acabou de digitar a quantidade colhida entende por que o app quer a
 * câmera; quem só abriu o formulário, não. E negar não interrompe nada — o
 * apontamento segue sendo salvo sem foto.
 */
export function PhotoCapture({
  attachments,
  onAdd,
  onRemove,
  disabled = false,
}: Props) {
  const [permissao, pedirPermissao] = useCameraPermissions();
  const [cameraAberta, setCameraAberta] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cameraRef = useRef<CameraView>(null);

  const noLimite = attachments.length >= MAX_ATTACHMENTS_PER_EXECUTION;

  async function abrirCamera() {
    setErro(null);

    const atual = permissao?.granted ? permissao : await pedirPermissao();
    if (!atual.granted) {
      setErro(
        atual.canAskAgain
          ? "Para anexar fotos, o app precisa de acesso à câmera."
          : "O acesso à câmera está bloqueado. Libere nas configurações do aparelho.",
      );
      return;
    }

    setCameraAberta(true);
  }

  async function tirarFoto() {
    if (processando) return;
    setProcessando(true);

    try {
      const foto = await cameraRef.current?.takePictureAsync();
      if (!foto) throw new Error("A câmera não devolveu a imagem.");

      // Fecha antes de comprimir: a compressão leva um instante perceptível e
      // deixar a câmera aberta sugeriria que dá para tirar outra foto já.
      setCameraAberta(false);
      onAdd(await persistCapturedPhoto(foto.uri));
    } catch {
      setCameraAberta(false);
      setErro("Não foi possível guardar a foto. Tente de novo.");
    } finally {
      setProcessando(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.cabecalho}>
        <Text variant="labelLarge">Fotos</Text>
        <Text variant="bodySmall" style={styles.muted}>
          {attachments.length} de {MAX_ATTACHMENTS_PER_EXECUTION}
        </Text>
      </View>

      {attachments.length > 0 ? (
        <View style={styles.miniaturas}>
          {attachments.map((attachment) => (
            <View key={attachment.clientId} style={styles.miniatura}>
              <Image
                source={{ uri: attachment.uri }}
                style={styles.imagem}
                accessibilityLabel="Foto anexada ao apontamento"
              />
              <IconButton
                icon="close"
                size={14}
                mode="contained"
                containerColor={brand.surface}
                iconColor={brand.danger}
                style={styles.remover}
                accessibilityLabel="Remover esta foto"
                disabled={disabled}
                onPress={() => onRemove(attachment)}
              />
            </View>
          ))}
        </View>
      ) : null}

      <Button
        mode="outlined"
        icon="camera-outline"
        disabled={disabled || noLimite || processando}
        loading={processando}
        onPress={abrirCamera}
      >
        {noLimite ? "Limite de fotos atingido" : "Adicionar foto"}
      </Button>

      {erro ? (
        <View style={styles.aviso}>
          <MaterialCommunityIcons
            name="camera-off-outline"
            size={18}
            color={brand.muted}
          />
          <Text variant="bodySmall" style={styles.avisoTexto}>
            {erro}
          </Text>
        </View>
      ) : null}

      <Modal
        visible={cameraAberta}
        animationType="slide"
        onRequestClose={() => setCameraAberta(false)}
      >
        <View style={styles.cameraTela}>
          <CameraView ref={cameraRef} style={styles.camera} facing="back" />

          <View style={styles.controles}>
            <Button
              mode="text"
              textColor={brand.surface}
              onPress={() => setCameraAberta(false)}
            >
              Cancelar
            </Button>

            <Pressable
              onPress={tirarFoto}
              disabled={processando}
              accessibilityRole="button"
              accessibilityLabel="Tirar foto"
              style={styles.disparador}
            >
              {processando ? (
                <ActivityIndicator color={brand.primary} />
              ) : (
                <View style={styles.disparadorInterno} />
              )}
            </Pressable>

            {/* Espaçador: mantém o disparador centrado sem medir a tela. */}
            <View style={styles.espacador} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  cabecalho: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  muted: { color: brand.muted },
  miniaturas: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  miniatura: { width: 72, height: 72 },
  imagem: {
    width: 72,
    height: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: brand.border,
    backgroundColor: brand.background,
  },
  remover: { position: "absolute", top: -10, right: -10, margin: 0 },
  aviso: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#F1F5F9",
    padding: spacing.md,
    borderRadius: 10,
  },
  avisoTexto: { color: brand.muted, flex: 1 },
  cameraTela: { flex: 1, backgroundColor: "#000000" },
  camera: { flex: 1 },
  controles: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    backgroundColor: "#000000",
  },
  disparador: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 4,
    borderColor: brand.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  disparadorInterno: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: brand.surface,
  },
  espacador: { width: 80 },
});
