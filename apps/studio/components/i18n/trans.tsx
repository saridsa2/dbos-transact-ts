import type { ReactNode } from 'react';

type TransProps = {
  id?: string;
  message?: string;
  values?: Record<string, unknown>;
  children?: ReactNode;
};

export function Trans({ children, message, values }: TransProps) {
  if (children !== undefined && children !== null) {
    return <>{children}</>;
  }

  return <>{formatMessage(message || '', values)}</>;
}

function formatMessage(message: string, values?: Record<string, unknown>) {
  if (!values) return message;

  return message.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}
