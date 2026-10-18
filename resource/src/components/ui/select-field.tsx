import type { ComponentProps, ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

// Radix reserves the empty string for clearing a selection. Keep empty options
// explicit so filters and optional relationships retain their existing meaning.
const EMPTY_VALUE = "__toonforge_empty__";
type Props = {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};
export function SelectField({
  value,
  onValueChange,
  children,
  id,
  className,
  "aria-label": label,
  ...props
}: Props) {
  return (
    <Select
      {...props}
      value={value || EMPTY_VALUE}
      onValueChange={(v) => onValueChange(v === EMPTY_VALUE ? "" : v)}
    >
      <SelectTrigger id={id} className={className} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {children}
      </SelectContent>
    </Select>
  );
}
export function SelectOption({
  value,
  ...props
}: ComponentProps<typeof SelectItem>) {
  return <SelectItem value={value || EMPTY_VALUE} {...props} />;
}
