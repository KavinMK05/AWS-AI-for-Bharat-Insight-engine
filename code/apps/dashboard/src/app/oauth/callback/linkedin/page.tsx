'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { connectLinkedInAccount } from '@/lib/api';

const LINKEDIN_STATE_KEY = 'oauth.linkedin.state';

function LinkedInCallbackContent() {
  const params = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connecting LinkedIn account...');

  useEffect(() => {
    const run = async () => {
      const code = params.get('code') ?? '';
      const returnedState = params.get('state') ?? '';
      const savedState = sessionStorage.getItem(LINKEDIN_STATE_KEY) ?? '';
      const redirectUri = process.env['NEXT_PUBLIC_LINKEDIN_REDIRECT_URI'] ?? '';

      if (!code || !returnedState || !savedState || !redirectUri) {
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
        await connectLinkedInAccount({
          code,
          redirectUri,
        });

        sessionStorage.removeItem(LINKEDIN_STATE_KEY);

        setStatus('success');
        setMessage('LinkedIn account connected successfully.');
      } catch (err: unknown) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to connect LinkedIn account.');
      }
    };

    run();
  }, [params]);

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-bold text-[var(--color-text)]">LinkedIn Connection</h1>
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

export default function LinkedInCallbackPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-xl px-4 py-16">Loading...</div>}>
      <LinkedInCallbackContent />
    </Suspense>
  );
}
