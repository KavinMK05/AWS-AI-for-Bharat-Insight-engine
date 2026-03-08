// ============================================================================
// API Client — Functions for calling the Gatekeeper Lambda API
// ============================================================================

import type { ApprovalDigest, DigestResult, HistoryQueryParams, HistoryResult } from './types';

export interface SocialConnectionStatus {
  connected: boolean;
  platformUsername?: string;
  connectedAt?: string;
  expiresAt?: string;
}

export interface SocialStatusResponse {
  twitter: SocialConnectionStatus;
  linkedin: SocialConnectionStatus;
}

const API_BASE_URL = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? '';

/**
 * Get the Cognito ID token from the current session.
 * This works by checking the Cognito storage in localStorage.
 */
function getCognitoIdToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  // Check for env var first (useful for local dev/testing without Cognito)
  const envToken = process.env['NEXT_PUBLIC_AUTH_TOKEN'];
  if (envToken) {
    return envToken;
  }

  // Try to get the last authenticated user from Cognito
  const userPoolId = process.env['NEXT_PUBLIC_COGNITO_USER_POOL_ID'];
  if (!userPoolId) {
    return null;
  }

  // Cognito stores the user key in localStorage
  const cognitoUserKey = `CognitoIdentityServiceProvider.${process.env['NEXT_PUBLIC_COGNITO_CLIENT_ID']}.LastAuthUser`;
  const lastAuthUser = localStorage.getItem(cognitoUserKey);

  if (!lastAuthUser) {
    return null;
  }

  // Get the ID token from the user's data
  const idTokenKey = `CognitoIdentityServiceProvider.${process.env['NEXT_PUBLIC_COGNITO_CLIENT_ID']}.${lastAuthUser}.idToken`;
  const idToken = localStorage.getItem(idTokenKey);

  return idToken;
}

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const token = getCognitoIdToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };

  // Add Authorization header if token is available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      (errorBody as { error?: string; message?: string }).error ??
      (errorBody as { error?: string; message?: string }).message ??
      `API error: ${res.status}`,
    );
  }

  return res.json() as Promise<T>;
}

/**
 * Fetch pending drafts grouped by content item (paginated).
 * Handles both the legacy flat array response and the new paginated response.
 */
export async function fetchDigest(page = 1, limit = 30, sort: 'asc' | 'desc' = 'desc'): Promise<DigestResult> {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(page));
  searchParams.set('limit', String(limit));
  searchParams.set('sort', sort);
  const raw = await apiFetch<DigestResult | ApprovalDigest[]>(
    `/api/digest?${searchParams.toString()}`,
  );

  // Handle legacy flat array response (pre-deployment)
  if (Array.isArray(raw)) {
    const start = (page - 1) * limit;
    const sliced = raw.slice(start, start + limit);
    return { items: sliced, total: raw.length, page, limit };
  }

  return raw;
}

/**
 * Approve a draft for publishing.
 */
export async function approveDraft(
  draftContentId: string,
): Promise<{ message: string; publishingQueueItemId: string }> {
  return apiFetch('/api/approve', {
    method: 'POST',
    body: JSON.stringify({ draftContentId }),
  });
}

/**
 * Reject a draft.
 */
export async function rejectDraft(draftContentId: string): Promise<{ message: string }> {
  return apiFetch('/api/reject', {
    method: 'POST',
    body: JSON.stringify({ draftContentId }),
  });
}

/**
 * Edit content and approve a draft.
 */
export async function editAndApproveDraft(
  draftContentId: string,
  editedContent: string,
): Promise<{ message: string; publishingQueueItemId: string }> {
  return apiFetch('/api/edit-approve', {
    method: 'POST',
    body: JSON.stringify({ draftContentId, editedContent }),
  });
}

/**
 * Check if the user is authenticated (has a valid token).
 */
export function isAuthenticated(): boolean {
  return getCognitoIdToken() !== null;
}

export async function fetchSocialStatus(): Promise<SocialStatusResponse> {
  return apiFetch<SocialStatusResponse>('/api/social/status');
}

export async function connectTwitterAccount(payload: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<{ message: string; platformUsername?: string; expiresAt?: string }> {
  return apiFetch('/api/social/connect/twitter', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function connectLinkedInAccount(payload: {
  code: string;
  redirectUri: string;
}): Promise<{ message: string; platformUsername?: string; expiresAt?: string }> {
  return apiFetch('/api/social/connect/linkedin', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Fetch publishing history with search and filtering.
 */
export async function fetchHistory(params: HistoryQueryParams): Promise<HistoryResult> {
  const searchParams = new URLSearchParams();
  if (params.topic) searchParams.set('topic', params.topic);
  if (params.platform) searchParams.set('platform', params.platform);
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));

  const qs = searchParams.toString();
  return apiFetch<HistoryResult>(`/api/history${qs ? `?${qs}` : ''}`);
}
