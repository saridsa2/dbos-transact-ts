import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
export function schemaValidator(schema: Record<string, unknown>) {
  if (Buffer.byteLength(JSON.stringify(schema)) > 16000) throw Error('Schema exceeds 16 KiB.');
  const Factory = String(schema.$schema ?? '').includes('2020') ? Ajv2020 : Ajv;
  return new Factory({ allErrors: true, strict: false, ownProperties: true }).compile(schema);
}
export function validateStructured(schema: Record<string, unknown>, text: string) {
  const validate = schemaValidator(schema);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      valid: false as const,
      feedback: 'Return only valid JSON matching the required output schema, without Markdown fences.',
    };
  }
  if (!validate(value))
    return {
      valid: false as const,
      feedback: JSON.stringify(
        validate.errors?.slice(0, 8).map((e) => ({ path: e.instancePath, error: e.message })),
      ).slice(0, 2000),
    };
  return { valid: true as const, value };
}
