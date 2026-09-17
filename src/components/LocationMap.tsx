import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { ActivityIndicator, Text } from "react-native-paper";
import { WebView } from "react-native-webview";

import type { Coordinates } from "@/lib/location";
import { brand, spacing } from "@/theme";

/**
 * Mapa embutido com OpenStreetMap, desenhado numa WebView com Leaflet.
 *
 * É um experimento. O caminho alternativo seria `react-native-maps` com o Maps
 * SDK do Google: o SDK móvel não é cobrado, mas exige projeto no Google Cloud,
 * chave de API, cartão cadastrado na conta de faturamento e rebuild do APK.
 * Leaflet com tiles do OpenStreetMap não pede nada disso.
 *
 * O preço é outro: os tiles vêm da rede. Sem conexão o mapa não desenha — e é
 * em campo, sem sinal, que o agricultor está. Por isso a mensagem de erro
 * explica o que aconteceu em vez de deixar um quadrado cinza.
 */
export function LocationMap({
  coordinates,
  height = 220,
}: {
  coordinates: Coordinates;
  height?: number;
}) {
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState(false);

  const { latitude, longitude, accuracy } = coordinates;

  // Recriar o HTML a cada render remontaria a WebView e piscaria o mapa.
  const html = useMemo(
    () => montarHtml(latitude, longitude, accuracy),
    [latitude, longitude, accuracy],
  );

  if (falhou) {
    return (
      <View style={[styles.aviso, { height }]}>
        <Text variant="bodySmall" style={styles.avisoTexto}>
          O mapa precisa de internet para carregar. A posição continua
          registrada.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <WebView
        source={{ html }}
        style={styles.webview}
        originWhitelist={["*"]}
        scrollEnabled={false}
        onLoadEnd={() => setCarregando(false)}
        onError={() => {
          setCarregando(false);
          setFalhou(true);
        }}
        onHttpError={() => {
          setCarregando(false);
          setFalhou(true);
        }}
      />
      {carregando ? (
        <View style={styles.carregando}>
          <ActivityIndicator size="small" color={brand.primary} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Página mínima com Leaflet: o marcador da posição e, quando o GPS informou a
 * precisão, um círculo com o raio de erro — que comunica melhor do que um número
 * o quanto aquela leitura é confiável.
 */
function montarHtml(
  latitude: number,
  longitude: number,
  accuracy: number | null,
): string {
  const circulo =
    accuracy !== null
      ? `L.circle([${latitude}, ${longitude}], {
           radius: ${accuracy},
           color: '${brand.primary}',
           fillColor: '${brand.primary}',
           fillOpacity: 0.15,
           weight: 1
         }).addTo(map);`
      : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: false, attributionControl: true })
      .setView([${latitude}, ${longitude}], 16);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    L.marker([${latitude}, ${longitude}]).addTo(map);
    ${circulo}
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: brand.border,
    marginBottom: spacing.md,
  },
  webview: { flex: 1 },
  carregando: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: brand.background,
  },
  aviso: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: brand.border,
    backgroundColor: brand.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  avisoTexto: { color: brand.muted, textAlign: "center" },
});
