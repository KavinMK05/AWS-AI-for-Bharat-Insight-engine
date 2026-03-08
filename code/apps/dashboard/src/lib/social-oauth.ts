export interface TwitterAuthRequest {
  authUrl: string;
  state: string;
  codeVerifier: string;
}

export interface LinkedInAuthRequest {
  authUrl: string;
  state: string;
}

function toBase64Url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes).slice(0, length);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return toBase64Url(new Uint8Array(digest));
}

export async function buildTwitterAuthRequest(config: {
  clientId: string;
  redirectUri: string;
}): Promise<TwitterAuthRequest> {
  const state = randomString(48);
  const codeVerifier = randomString(96);
  const codeChallenge = await createCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'tweet.read tweet.write users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    authUrl: `https://x.com/i/oauth2/authorize?${params.toString()}`,
    state,
    codeVerifier,
  };
}

export function buildLinkedInAuthRequest(config: {
  clientId: string;
  redirectUri: string;
}): LinkedInAuthRequest {
  const state = randomString(48);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid profile email w_member_social',
    state,
  });

  return {
    authUrl: `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`,
    state,
  };
}
