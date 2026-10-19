'use client';
import {
  Children,
  isValidElement,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactElement,
} from 'react';
import { Button, type ButtonProps } from '@/components/base/buttons/button';
import { InputBase, TextField } from '@/components/base/input/input';
import { NativeSelect } from '@/components/base/select/select-native';

/** Native event adapters keep control-plane forms independent of the UI library. */
export function ControlButton({
  disabled,
  className,
  color,
  ...props
}: Omit<ButtonProps, 'isDisabled'> & { disabled?: boolean }) {
  return (
    <Button
      {...props}
      isDisabled={disabled}
      color={color ?? (className?.includes('cp-primary') ? 'primary' : 'secondary')}
      className={className}
    />
  );
}
export function ControlInput({
  disabled,
  required,
  className,
  type,
  onChange,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <TextField
      isDisabled={disabled}
      isRequired={required}
      className={className}
      aria-label={props['aria-label'] ?? props.placeholder}
    >
      <InputBase {...props} type={type} onChange={onChange} isDisabled={disabled} isRequired={required} size="sm" />
    </TextField>
  );
}
export function ControlSelect({ children, className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  function options(nodes: React.ReactNode): { label: string; value: string; disabled?: boolean }[] {
    return Children.toArray(nodes).flatMap((node) => {
      if (!isValidElement(node)) return [];
      const element = node as ReactElement<{ children?: React.ReactNode; value?: string; disabled?: boolean }>;
      if (element.type !== 'option') return options(element.props.children);
      const label = Children.toArray(element.props.children).join('');
      return [{ label, value: String(element.props.value ?? label), disabled: element.props.disabled }];
    });
  }
  return <NativeSelect {...props} size="sm" className={className} options={options(children)} />;
}

import { ModalOverlay, Modal, Dialog } from '@/components/application/modals/modal';
export function ControlModal({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="cp-modal-backdrop"
    >
      <Modal className="cp-modal-container">
        <Dialog aria-label={label}>{children}</Dialog>
      </Modal>
    </ModalOverlay>
  );
}
