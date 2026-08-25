import { MD3LightTheme } from "react-native-paper";

/**
 * Paleta alinhada ao front web (`emerald-600` como cor de marca), adaptada
 * para o Material Design 3 do react-native-paper.
 */
export const brand = {
  primary: "#059669",
  primaryDark: "#047857",
  primaryLight: "#D1FAE5",
  warning: "#B45309",
  warningLight: "#FEF3C7",
  danger: "#B91C1C",
  dangerLight: "#FEE2E2",
  info: "#1D4ED8",
  infoLight: "#DBEAFE",
  muted: "#64748B",
  border: "#E2E8F0",
  surface: "#FFFFFF",
  background: "#F8FAFC",
} as const;

export const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: brand.primary,
    onPrimary: "#FFFFFF",
    primaryContainer: brand.primaryLight,
    onPrimaryContainer: "#064E3B",
    secondary: "#0F766E",
    background: brand.background,
    surface: brand.surface,
    surfaceVariant: "#F1F5F9",
    onSurfaceVariant: brand.muted,
    outline: brand.border,
    outlineVariant: "#EEF2F6",
    error: brand.danger,
    errorContainer: brand.dangerLight,
  },
};

export type AppTheme = typeof theme;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;
