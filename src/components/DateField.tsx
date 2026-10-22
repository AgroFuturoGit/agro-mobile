import type { ReactNode } from "react";
import { TextInput } from "react-native-paper";

import { maskDateInput } from "@/lib/format";

/**
 * Campo de data. `numbers-and-punctuation` é exclusivo do iOS e, no Android,
 * cai no teclado de texto — nada impedia letra num campo que a API só aceita
 * como data. `number-pad` vale nos dois, e a máscara filtra o resto.
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
