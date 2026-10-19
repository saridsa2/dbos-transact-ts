// English adapter for the imported editor's message descriptors. Locale catalogs
// belong to the host app; the standalone studio currently uses English.
export function useLingui() {
  return {
    _: (message: string | { id?: string; message?: string }, values?: Record<string, unknown>) => {
      const text = typeof message === 'string' ? message : message.message || message.id || '';
      return text.replace(/\{(\w+)\}/g, (match, key: string) =>
        values?.[key] === undefined ? match : String(values[key]),
      );
    },
  };
}
