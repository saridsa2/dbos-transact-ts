import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Identity } from '../../lib/control/contracts';
import { identitySchema } from '../../lib/control/contracts';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export interface AuthAdapter {
  name: string;
  authenticate(request: IncomingMessage): Promise<Identity | null>;
  loginUrl?: string;
  handle?: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
}
export function cookie(request: IncomingMessage, name: string): string | undefined {
  return request.headers.cookie
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export function checkedIdentity(value: unknown): Identity | null {
  if (value === null) return null;
  const identity = identitySchema.parse(value);
  if (identity.expiresAt && new Date(identity.expiresAt).getTime() <= Date.now()) return null;
  return identity;
}
export async function loadAuthAdapter(): Promise<AuthAdapter | null> {
  const modulePath = process.env.STUDIO_AUTH_ADAPTER_MODULE;
  if (modulePath) {
    const module = await import(pathToFileURL(resolve(modulePath)).href);
    const adapter = module.default ?? module.adapter;
    if (!adapter || typeof adapter.authenticate !== 'function' || typeof adapter.name !== 'string')
      throw new Error('Authentication adapter must export an AuthAdapter.');
    return adapter;
  }
  if (process.env.NODE_ENV === 'production' || process.env.STUDIO_AUTH_MODE === 'external')
    throw new Error('Configure STUDIO_AUTH_ADAPTER_MODULE for enterprise identity.');
  return null;
}
export type TemporaryCredential = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: string;
};
export interface CredentialResolver {
  resolve(input: {
    workspaceId: string;
    connectionId: string;
    revision: number;
    provider: string;
    config: Record<string, unknown>;
    secret?: string;
  }): Promise<TemporaryCredential>;
}
export async function loadCredentialResolver(): Promise<CredentialResolver | null> {
  if (!process.env.STUDIO_CREDENTIAL_RESOLVER_MODULE) return null;
  const module = await import(pathToFileURL(resolve(process.env.STUDIO_CREDENTIAL_RESOLVER_MODULE)).href);
  const resolver = module.default ?? module.resolver;
  if (!resolver || typeof resolver.resolve !== 'function')
    throw new Error('Credential resolver must export resolve().');
  return resolver;
}
