/**
 * SLAS guest authentication, supporting both client types:
 *
 * - Private client (SFCC_SECRET is set): client_credentials grant with Basic auth.
 * - Public client (SFCC_SECRET is empty): guest authorization-code flow with PKCE.
 *   This is the flow required by Salesforce's hosted demo backend (the PWA Kit
 *   demo credentials), which uses a public SLAS client with no secret.
 */

const slasBase = () =>
  `https://${process.env.SFCC_SHORTCODE}.api.commercecloud.salesforce.com/shopper/auth/v1/organizations/${process.env.SFCC_ORGANIZATIONID}`;

// Must be registered as a redirect URI on the SLAS client. It is never visited:
// the authorize response's redirect is only parsed for the code/usid params.
const SLAS_REDIRECT_URI = 'http://localhost:3000/callback';

export async function getGuestUserAuthToken(): Promise<{ access_token: string }> {
  return process.env.SFCC_SECRET ? getPrivateClientGuestToken() : getPublicClientGuestToken();
}

async function getPrivateClientGuestToken(): Promise<{ access_token: string }> {
  const credentials = Buffer.from(
    `${process.env.SFCC_CLIENT_ID}:${process.env.SFCC_SECRET}`
  ).toString('base64');

  const res = await fetch(`${slasBase()}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      channel_id: process.env.SFCC_SITEID!
    }),
    cache: 'no-store'
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch guest token: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

async function getPublicClientGuestToken(): Promise<{ access_token: string }> {
  const { codeVerifier, codeChallenge } = await generatePkcePair();

  const authorizeUrl = new URL(`${slasBase()}/oauth2/authorize`);
  authorizeUrl.searchParams.set('redirect_uri', SLAS_REDIRECT_URI);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('hint', 'guest');
  authorizeUrl.searchParams.set('client_id', process.env.SFCC_CLIENT_ID!);
  authorizeUrl.searchParams.set('channel_id', process.env.SFCC_SITEID!);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);

  const authorizeRes = await fetch(authorizeUrl, { redirect: 'manual', cache: 'no-store' });
  const location = authorizeRes.headers.get('location');

  if (!location) {
    throw new Error(
      `SLAS authorize did not redirect: ${authorizeRes.status} ${await authorizeRes.text()}`
    );
  }

  const redirect = new URL(location);
  const code = redirect.searchParams.get('code');
  const usid = redirect.searchParams.get('usid');

  if (!code) {
    throw new Error(`SLAS authorize response did not include a code: ${location}`);
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code_pkce',
    code,
    code_verifier: codeVerifier,
    client_id: process.env.SFCC_CLIENT_ID!,
    channel_id: process.env.SFCC_SITEID!,
    redirect_uri: SLAS_REDIRECT_URI
  });
  if (usid) body.set('usid', usid);

  const tokenRes = await fetch(`${slasBase()}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store'
  });

  if (!tokenRes.ok) {
    throw new Error(`Failed to fetch guest token: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  return tokenRes.json();
}

async function generatePkcePair() {
  const randomBytes = new Uint8Array(48);
  crypto.getRandomValues(randomBytes);
  const codeVerifier = Buffer.from(randomBytes).toString('base64url');

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = Buffer.from(digest).toString('base64url');

  return { codeVerifier, codeChallenge };
}
