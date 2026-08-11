# ADR 0002: Use OIDC Through a Backend-for-Frontend Session

## Context

The reference product is browser-first and multi-tenant. Storing long-lived provider tokens in browser JavaScript increases exposure to XSS and complicates revocation.

## Decision

Use an OIDC Authorization Code flow through the NestJS BFF. The BFF validates identity-provider responses and issues a server-side session represented in the browser by an opaque `HttpOnly`, `Secure`, appropriately scoped `SameSite` cookie. Store a hash of the session secret in PostgreSQL initially. Cookie-authenticated state changes use CSRF protection.

## Alternatives considered

- SPA bearer tokens stored in browser JavaScript.
- Self-managed passwords from the first release.
- Stateless JWT session cookies.

## Consequences

The API owns session revocation, rotation, and device visibility. It must protect the OIDC callback and CSRF boundary. Mobile and machine clients use distinct OAuth flows/audiences.

## Reconsider when

A non-browser client becomes the primary product surface, or measured session scale requires a dedicated session store with an explicit durability/failover design.
