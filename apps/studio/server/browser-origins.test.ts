import { describe, expect, it } from 'vitest';
import { browserOrigins } from './browser-origins';

describe('private preview browser origins', () => {
  it('keeps localhost working without allowing arbitrary sites', () => {
    const origins = browserOrigins('');
    expect(origins.has('http://127.0.0.1:3100')).toBe(true);
    expect(origins.has('http://localhost:3100')).toBe(true);
    expect(origins.has('https://untrusted.example')).toBe(false);
  });
  it('allows only configured origins, including scheme and port', () => {
    const origins = browserOrigins(' https://preview.example/, https://preview.example:8443 ');
    expect(origins.has('https://preview.example')).toBe(true);
    expect(origins.has('https://preview.example:8443')).toBe(true);
    expect(origins.has('http://preview.example')).toBe(false);
    expect(origins.has('https://preview.example.evil.test')).toBe(false);
    expect(origins.has('https://other.preview.example')).toBe(false);
  });
  it.each([
    'https://user:password@preview.example',
    'https://preview.example/path',
    'https://preview.example?query=1',
    'https://preview.example#fragment',
    'file:///tmp',
    '*',
    'null',
  ])('rejects invalid configuration: %s', (value) => {
    expect(() => browserOrigins(value)).toThrow();
  });
});
