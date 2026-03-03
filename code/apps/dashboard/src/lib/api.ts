// ============================================================================
// API Client — Functions for calling the Gatekeeper Lambda API
// ============================================================================

import type { ApprovalDigest } from './types';

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
 * Fetch all pending drafts grouped by content item.
 */
export async function fetchDigest(): Promise<ApprovalDigest[]> {
  return apiFetch<ApprovalDigest[]>('/api/digest');
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
