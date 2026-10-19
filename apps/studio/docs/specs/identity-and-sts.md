# Identity federation and credential exchange

## Two adapter boundaries

Enterprise identity establishes who the customer user is. AWS STS establishes temporary service credentials for an authorized connection. The control plane treats these as separate adapters. Neither a provider API key nor an AWS session token is a customer login credential.

## Authentication adapter

`server/control/auth.ts` defines `AuthAdapter`. Configure `STUDIO_AUTH_ADAPTER_MODULE` to load a trusted local module exporting `default` or `adapter`:

```ts
interface AuthAdapter {
  name: string;
  authenticate(request: IncomingMessage): Promise<Identity | null>;
  loginUrl?: string;
  handle?(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
}
```

`Identity` contains issuer, stable subject, email, display name, verified-email status and optional expiry. Adapters must validate the original credential, issuer/trust configuration, intended audience and expiry before returning an identity. Browser login implementations must also handle their protocol's state, nonce, callback and logout requirements. OIDC validation follows the [OpenID Connect ID token validation contract](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation). SAML or enterprise STS can terminate at a trusted identity gateway or a dedicated adapter; arbitrary browser identity headers are not trusted by the application.

The application keys users by issuer/subject and resolves roles from membership tables. It ignores extra role claims. Expired adapter identities are rejected. A callback handler can own `/api/auth/*`; its implementation owns callback verification and CSRF protection. Sign-out currently clears the Studio development session; external adapters/gateways must implement their own provider session termination.

Without an external adapter, loopback development uses an explicitly labelled local identity form and hashed, eight-hour opaque session cookies with HttpOnly/SameSite=Strict. This mode has no identity proof and must not be deployed as customer authentication. Service startup refuses development identity when `NODE_ENV=production` or `STUDIO_AUTH_MODE=external`. A production deployment must also set `STUDIO_CREDENTIAL_KEY` and use HTTPS.

## Temporary credential resolver

`CredentialResolver.resolve()` receives the authorized workspace/connection IDs, current revision, provider configuration and an optional decrypted external ID. It returns an access key ID, secret access key, session token and ISO expiry. Configure `STUDIO_CREDENTIAL_RESOLVER_MODULE` with a trusted resolver exporting `default` or `resolver`.

The worker-only `ControlPlane.resolveCredential(workspaceId, connectionId, revision)` method enforces workspace, lifecycle and revision checks before invoking the resolver. Static secrets are resolved at this boundary as well. No HTTP route returns the broker's result. Sessions expiring within sixty seconds are rejected. The current resolver is called on each resolution; there is no token cache to invalidate or renew in the browser.

The initial AWS connection stores role ARN, region, requested duration and optional encrypted external ID. An AWS resolver should use its deployed workload identity to assume the customer's role and return the resulting credentials. It must enforce trust policy, role duration and session constraints. AWS documents a 900–43200 second request range, further limited by the role, with a one-hour limit for role chaining. [AWS AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html).

The first slice provides the resolver boundary, expiry checks and connection UI. It does not ship a configured AWS caller identity or invoke STS by itself. Additional token-service/OAuth credential exchanges can implement a separately typed resolver contract as integration requirements become concrete.

## Deployment and tests

Auth adapters and credential resolvers are trusted server modules loaded before the service begins handling requests. Keep authentication tokens, workload identity and provider secrets out of graphs and client metadata. A resolver's temporary credential object must remain in process memory and provider calls; it must never become a DBOS step output or node result.

Before enterprise rollout, select and test the actual identity/token-service implementation, reverse-proxy trust boundary, callback/session lifecycle, deployed secret-key backend and AWS resolver. Tests cover wrong issuer/audience in the selected adapter, expired login/session tokens, revoked membership, cross-workspace connection attempts, expired temporary credentials and sanitized failure handling.
