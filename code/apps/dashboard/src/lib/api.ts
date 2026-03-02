// ============================================================================
// API Client — Functions for calling the Gatekeeper Lambda API
// ============================================================================

import type { ApprovalDigest } from './types';

const API_BASE_URL = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? '';

/**
 * Retrieve the auth token from localStorage (set after Cognito login).
 * For local development/testing, you can also set NEXT_PUBLIC_AUTH_TOKEN
 * in .env.local to bypass Cognito entirely.
 */
function getAuthToken(): string | null {
  // Check env var first (useful for local dev/testing without Cognito)
  const envToken = process.env['NEXT_PUBLIC_AUTH_TOKEN'];
  if (envToken) {
    return envToken;
  }

  // Check localStorage (set by Cognito login flow)
  if (typeof window !== 'undefined') {
    return localStorage.getItem('insight_engine_token');
  }

  return null;
}

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const token = getAuthToken();

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
      (errorBody as { error?: string }).error ?? `API error: ${res.status}`,
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
 * Store a JWT token (e.g. from Cognito login) for API requests.
 */
export function setAuthToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('insight_engine_token', token);
  }
}

/**
 * Clear the stored auth token (logout).
 */
export function clearAuthToken(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('insight_engine_token');
  }
}
