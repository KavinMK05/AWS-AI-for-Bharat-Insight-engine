'use client';

import { useEffect, useMemo, useState } from 'react';

import { AuthGuard } from '@/components/auth-guard';
import { fetchSocialStatus } from '@/lib/api';
import type { SocialStatusResponse } from '@/lib/api';
import {
  buildLinkedInAuthRequest,
  buildTwitterAuthRequest,
} from '@/lib/social-oauth';

const TWITTER_STATE_KEY = 'oauth.twitter.state';
const TWITTER_VERIFIER_KEY = 'oauth.twitter.codeVerifier';
const LINKEDIN_STATE_KEY = 'oauth.linkedin.state';

function formatDate(value?: string): string {
  if (!value) {
    return 'Not available';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function SettingsContent() {
  const [status, setStatus] = useState<SocialStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<'twitter' | 'linkedin' | null>(null);

  const twitterClientId = process.env['NEXT_PUBLIC_TWITTER_CLIENT_ID'] ?? '';
  const twitterRedirectUri = process.env['NEXT_PUBLIC_TWITTER_REDIRECT_URI'] ?? '';
  const linkedInClientId = process.env['NEXT_PUBLIC_LINKEDIN_CLIENT_ID'] ?? '';
  const linkedInRedirectUri = process.env['NEXT_PUBLIC_LINKEDIN_REDIRECT_URI'] ?? '';

  const missingConfigMessage = useMemo(() => {
    const missing: string[] = [];

    if (!twitterClientId) missing.push('NEXT_PUBLIC_TWITTER_CLIENT_ID');
    if (!twitterRedirectUri) missing.push('NEXT_PUBLIC_TWITTER_REDIRECT_URI');
    if (!linkedInClientId) missing.push('NEXT_PUBLIC_LINKEDIN_CLIENT_ID');
    if (!linkedInRedirectUri) missing.push('NEXT_PUBLIC_LINKEDIN_REDIRECT_URI');

    if (missing.length === 0) {
      return null;
    }

    return `Missing dashboard OAuth config: ${missing.join(', ')}`;
  }, [linkedInClientId, linkedInRedirectUri, twitterClientId, twitterRedirectUri]);

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const response = await fetchSocialStatus();
        setStatus(response);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load social account status');
      } finally {
        setLoading(false);
      }
    };

    loadStatus();
  }, []);

  const connectTwitter = async () => {
    if (missingConfigMessage) {
      setError(missingConfigMessage);
      return;
    }

    setConnecting('twitter');

    try {
      const request = await buildTwitterAuthRequest({
        clientId: twitterClientId,
        redirectUri: twitterRedirectUri,
      });

      sessionStorage.setItem(TWITTER_STATE_KEY, request.state);
      sessionStorage.setItem(TWITTER_VERIFIER_KEY, request.codeVerifier);
      window.location.href = request.authUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start Twitter OAuth');
      setConnecting(null);
    }
  };

  const connectLinkedIn = async () => {
    if (missingConfigMessage) {
      setError(missingConfigMessage);
      return;
    }

    setConnecting('linkedin');

    try {
      const request = buildLinkedInAuthRequest({
        clientId: linkedInClientId,
        redirectUri: linkedInRedirectUri,
      });

      sessionStorage.setItem(LINKEDIN_STATE_KEY, request.state);
      window.location.href = request.authUrl;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start LinkedIn OAuth');
      setConnecting(null);
    }
  };

  if (loading) {
    return <div className="py-10 text-sm text-[var(--color-text-muted)]">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Publishing Accounts</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Connect your own X and LinkedIn accounts. Approved drafts publish to your connected accounts.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-4">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Twitter / X</h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Status: {status?.twitter.connected ? 'Connected' : 'Not connected'}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Account: {status?.twitter.platformUsername ?? 'Not available'}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Connected at: {formatDate(status?.twitter.connectedAt)}
          </p>
          <button
            onClick={connectTwitter}
            disabled={connecting !== null}
            className="mt-4 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {connecting === 'twitter'
              ? 'Redirecting...'
              : status?.twitter.connected
                ? 'Reconnect Twitter'
                : 'Connect Twitter'}
          </button>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-white p-4">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">LinkedIn</h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Status: {status?.linkedin.connected ? 'Connected' : 'Not connected'}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Account: {status?.linkedin.platformUsername ?? 'Not available'}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Connected at: {formatDate(status?.linkedin.connectedAt)}
          </p>
          <button
            onClick={connectLinkedIn}
            disabled={connecting !== null}
            className="mt-4 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {connecting === 'linkedin'
              ? 'Redirecting...'
              : status?.linkedin.connected
                ? 'Reconnect LinkedIn'
                : 'Connect LinkedIn'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AuthGuard>
      <SettingsContent />
    </AuthGuard>
  );
}
