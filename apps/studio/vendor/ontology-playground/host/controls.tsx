'use client';
import type { TextareaHTMLAttributes } from 'react';
import { TextField } from '@/components/base/input/input';
import { TextAreaBase } from '@/components/base/textarea/textarea';
export function DesignerTextArea({
  disabled,
  readOnly,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <TextField isDisabled={disabled} aria-label={props['aria-label'] ?? props.placeholder ?? 'Description'}>
      <TextAreaBase {...props} size="sm" disabled={disabled} readOnly={readOnly} className={className} />
    </TextField>
  );
}
