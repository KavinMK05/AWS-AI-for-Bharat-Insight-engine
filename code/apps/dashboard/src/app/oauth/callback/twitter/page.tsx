'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { connectTwitterAccount } from '@/lib/api';

const TWITTER_STATE_KEY = 'oauth.twitter.state';
const TWITTER_VERIFIER_KEY = 'oauth.twitter.codeVerifier';

function TwitterCallbackContent() {
  const params = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connecting Twitter account...');

  useEffect(() => {
    const run = async () => {
      const code = params.get('code') ?? '';
      const returnedState = params.get('state') ?? '';
      const savedState = sessionStorage.getItem(TWITTER_STATE_KEY) ?? '';
      const codeVerifier = sessionStorage.getItem(TWITTER_VERIFIER_KEY) ?? '';
      const redirectUri = process.env['NEXT_PUBLIC_TWITTER_REDIRECT_URI'] ?? '';

      if (!code || !returnedState || !savedState || !codeVerifier || !redirectUri) {
        setStatus('error');
        setMessage('Missing OAuth callback parameters. Please retry from Settings.');
        return;
      }

      if (returnedState !== savedState) {
        setStatus('error');
        setMessage('OAuth state mismatch. Please retry from Settings.');
        return;
      }

      try {
        await connectTwitterAccount({
          code,
          codeVerifier,
          redirectUri,
        });

        sessionStorage.removeItem(TWITTER_STATE_KEY);
        sessionStorage.removeItem(TWITTER_VERIFIER_KEY);

        setStatus('success');
        setMessage('Twitter account connected successfully.');
      } catch (err: unknown) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to connect Twitter account.');
      }
    };

    run();
  }, [params]);

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-bold text-[var(--color-text)]">Twitter Connection</h1>
      <p className="mt-3 text-sm text-[var(--color-text-muted)]">{message}</p>
      {status !== 'loading' && (
        <Link
          href="/settings"
          className="mt-6 inline-block rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white"
        >
          Back to Settings
        </Link>
      )}
    </div>
  );
}

export default function TwitterCallbackPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-xl px-4 py-16">Loading...</div>}>
      <TwitterCallbackContent />
    </Suspense>
  );
}
