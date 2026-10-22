'use client';
/** Untitled UI adapters for the imported form. No authorization or execution lives here. */
import type { ComponentProps, InputHTMLAttributes, Ref, TextareaHTMLAttributes } from 'react';
import { Button as UntitledButton } from '@/components/base/buttons/button';
import { InputBase, TextField, type InputBaseProps } from '@/components/base/input/input';
import { TextAreaBase } from '@/components/base/textarea/textarea';
import { Checkbox } from '@/components/base/checkbox/checkbox';

export function Button({
  variant,
  disabled,
  size,
  onClick,
  ...props
}: Omit<ComponentProps<typeof UntitledButton>, 'size' | 'onClick'> & {
  variant?: string;
  disabled?: boolean;
  size?: string;
  onClick?: () => void;
}) {
  return (
    <UntitledButton
      {...props}
      size="sm"
      color={variant === 'default' ? 'primary' : 'secondary'}
      isDisabled={disabled}
      onPress={onClick}
    />
  );
}
export function Input({
  disabled,
  required,
  ref,
  size: _size,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement>; icon?: InputBaseProps['icon'] }) {
  return (
    <TextField isDisabled={disabled} isRequired={required}>
      <InputBase {...props} ref={ref} isDisabled={disabled} />
    </TextField>
  );
}
export function Textarea({
  disabled,
  required,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <TextField isDisabled={disabled} isRequired={required}>
      <TextAreaBase {...props} ref={ref} />
    </TextField>
  );
}
export function Switch({
  checked,
  disabled,
  onCheckedChange,
  id,
  className,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (value: boolean) => void;
  id: string;
  size?: string;
  className?: string;
  label?: string;
}) {
  return (
    <Checkbox
      id={id}
      className={className}
      label={label}
      aria-labelledby={label ? undefined : `${id}-label`}
      isSelected={checked}
      isDisabled={disabled}
      onChange={onCheckedChange}
    />
  );
}
