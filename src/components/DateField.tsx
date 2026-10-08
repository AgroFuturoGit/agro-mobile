import type { ReactNode } from "react";
import { TextInput } from "react-native-paper";

import { maskDateInput } from "@/lib/format";

/**
 * Campo de data.
 *
 * Existe porque `keyboardType="numbers-and-punctuation"` é exclusivo do iOS:
 * no Android — que é onde o APK roda — ele cai no teclado de texto comum, e
 * nada impedia de digitar letra num campo que a API só aceita como data.
 *
 * `number-pad` vale nas duas plataformas, e a máscara cuida do resto: filtra
 * o que não for dígito, inclusive em texto colado, e põe as barras sozinha.
 */
export function DateField({
  label,
  value,
  onChangeText,
  error = false,
  disabled = false,
  right,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: boolean;
  disabled?: boolean;
  right?: ReactNode;
}) {
  return (
    <TextInput
      label={label}
      value={value}
      onChangeText={(texto) => onChangeText(maskDateInput(texto))}
      mode="outlined"
      keyboardType="number-pad"
      placeholder="dd/mm/aaaa"
      maxLength={10}
      right={right}
      error={error}
      disabled={disabled}
    />
  );
}
