'use client';

import { useEffect, useMemo, useState } from 'react';

import { AuthGuard } from '@/components/auth-guard';
import { fetchSocialStatus, fetchSettings, updateSettings } from '@/lib/api';
import type { SocialStatusResponse } from '@/lib/api';
import type { PersonaFile } from '@/lib/types';
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

function PersonaSettingsSection() {
  const [settings, setSettings] = useState<PersonaFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [localStrings, setLocalStrings] = useState({
    expertiseTopics: '',
    rssFeedUrls: '',
    arxivCategories: '',
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchSettings();
      setSettings(data);
      setLocalStrings({
        expertiseTopics: data.expertiseTopics.join(', '),
        rssFeedUrls: data.rssFeedUrls.join(', '),
        arxivCategories: data.arxivCategories.join(', '),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load persona settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      await updateSettings(settings);
      setSuccess('Settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field: keyof PersonaFile, value: string | number | boolean) => {
    if (!settings) return;
    setSettings({ ...settings, [field]: value });
  };

  const handleStringArrayChange = (field: 'expertiseTopics' | 'rssFeedUrls' | 'arxivCategories', value: string) => {
    setLocalStrings((prev) => ({ ...prev, [field]: value }));
    if (!settings) return;
    const arrayValues = value.split(',').map(s => s.trim()).filter(Boolean);
    setSettings({ ...settings, [field]: arrayValues });
  };

  const handlePlatformPreferenceChange = (
    platform: 'twitter' | 'linkedin',
    field: 'hashtags' | 'emoji' | 'maxThreadLength',
    value: boolean | number
  ) => {
    if (!settings) return;
    setSettings({
      ...settings,
      platformPreferences: {
        ...settings.platformPreferences,
        [platform]: {
          ...settings.platformPreferences[platform],
          [field]: value,
        },
      },
    });
  };

  if (loading) {
    return <div className="py-10 text-sm text-[var(--color-text-muted)]">Loading persona config...</div>;
  }

  if (error && !settings) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
        <button onClick={loadSettings} className="ml-4 underline">Retry</button>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="mt-12 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">System Configuration</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Configure ingestion sources and persona generation rules.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-8 rounded-lg border border-[var(--color-border)] bg-white p-6 md:p-8">
        
        {/* Ingestion Sources */}
        <section>
          <h2 className="text-lg font-semibold mb-4 text-[var(--color-text)] border-b pb-2">Ingestion Sources</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                RSS Feed URLs (Comma separated)
              </label>
              <textarea
                value={localStrings.rssFeedUrls}
                onChange={(e) => handleStringArrayChange('rssFeedUrls', e.target.value)}
                className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] border p-2 bg-gray-50 h-24"
                placeholder="https://example.com/feed.xml, https://example.org/rss"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                arXiv Categories (Comma separated)
              </label>
              <input
                type="text"
                value={localStrings.arxivCategories}
                onChange={(e) => handleStringArrayChange('arxivCategories', e.target.value)}
                className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] border p-2 bg-gray-50"
                placeholder="cs.AI, stat.ML"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Monitoring Interval
              </label>
              <select
                value={settings.monitoringInterval}
                onChange={(e) => handleChange('monitoringInterval', e.target.value)}
                className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] border p-2 bg-gray-50"
              >
                <option value="hourly">Hourly</option>
                <option value="every-6h">Every 6 Hours</option>
                <option value="daily">Daily</option>
              </select>
            </div>
          </div>
        </section>

        {/* Persona configuration */}
        <section>
          <h2 className="text-lg font-semibold mb-4 text-[var(--color-text)] border-b pb-2">Persona Configuration</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tone</label>
                <select
                  value={settings.tone}
                  onChange={(e) => handleChange('tone', e.target.value)}
                  className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] border p-2 bg-gray-50"
                >
                  <option value="formal">Formal</option>
                  <option value="casual">Casual</option>
                  <option value="technical">Technical</option>
                  <option value="humorous">Humorous</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Relevance Threshold (0-100)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={settings.relevanceThreshold}
                  onChange={(e) => handleChange('relevanceThreshold', parseInt(e.target.value, 10) || 0)}
                  className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] border p-2 bg-gray-50"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Expertise Topics (Comma separated)
              </label>
              <textarea
                value={localStrings.expertiseTopics}
                onChange={(e) => handleStringArrayChange('expertiseTopics', e.target.value)}
                className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] border p-2 bg-gray-50 h-24"
              />
            </div>
          </div>
        </section>

        {/* Platform Preferences */}
        <section>
          <h2 className="text-lg font-semibold mb-4 text-[var(--color-text)] border-b pb-2">Generation Preferences</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3 bg-gray-50 p-4 rounded-md border border-gray-100">
              <h3 className="font-semibold text-[#1da1f2]">Twitter</h3>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={settings.platformPreferences.twitter.hashtags}
                    onChange={(e) => handlePlatformPreferenceChange('twitter', 'hashtags', e.target.checked)}
                    className="rounded text-[var(--color-primary)] focus:ring-[var(--color-primary)] h-4 w-4"
                  />
                  Use Hashtags
                </label>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={settings.platformPreferences.twitter.emoji}
                    onChange={(e) => handlePlatformPreferenceChange('twitter', 'emoji', e.target.checked)}
                    className="rounded text-[var(--color-primary)] focus:ring-[var(--color-primary)] h-4 w-4"
                  />
                  Use Emojis
                </label>
              </div>
              <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Thread Length
                </label>
                <input
                  type="number"
                  min="1"
                  max="25"
                  value={settings.platformPreferences.twitter.maxThreadLength}
                  onChange={(e) => handlePlatformPreferenceChange('twitter', 'maxThreadLength', parseInt(e.target.value, 10) || 1)}
                  className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] border p-2 bg-white"
                />
              </div>
            </div>

            <div className="space-y-3 bg-gray-50 p-4 rounded-md border border-gray-100">
              <h3 className="font-semibold text-[#0a66c2]">LinkedIn</h3>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={settings.platformPreferences.linkedin.hashtags}
                    onChange={(e) => handlePlatformPreferenceChange('linkedin', 'hashtags', e.target.checked)}
                    className="rounded text-[var(--color-primary)] focus:ring-[var(--color-primary)] h-4 w-4"
                  />
                  Use Hashtags
                </label>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={settings.platformPreferences.linkedin.emoji}
                    onChange={(e) => handlePlatformPreferenceChange('linkedin', 'emoji', e.target.checked)}
                    className="rounded text-[var(--color-primary)] focus:ring-[var(--color-primary)] h-4 w-4"
                  />
                  Use Emojis
                </label>
              </div>
            </div>
          </div>
        </section>

        <div className="pt-4 border-t flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className={`px-6 py-2 rounded-md font-medium text-white transition-colors ${
              saving
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)]'
            }`}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
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
      <PersonaSettingsSection />
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
