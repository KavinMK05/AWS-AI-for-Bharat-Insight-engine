// ============================================================================
// EditModal — Modal with textarea for editing draft content before approval
// ============================================================================

'use client';

import { useState } from 'react';
import type { DraftContent } from '@/lib/types';

interface EditModalProps {
  draft: DraftContent;
  onSave: (editedContent: string) => void;
  onCancel: () => void;
}

export function EditModal({ draft, onSave, onCancel }: EditModalProps) {
  let initialContent: string;
  try {
    const parsed = JSON.parse(draft.content);
    initialContent =
      typeof parsed === 'string'
        ? parsed
        : Array.isArray(parsed)
          ? parsed.join('\n\n')
          : String(parsed);
  } catch {
    initialContent = draft.content;
  }

  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    setSaving(true);
    // For Twitter, re-encode as JSON array split by double newlines
    let finalContent: string;
    if (draft.platform === 'twitter') {
      const tweets = content
        .split('\n\n')
        .map((t) => t.trim())
        .filter(Boolean);
      finalContent = JSON.stringify(tweets);
    } else {
      finalContent = JSON.stringify(content);
    }
    onSave(finalContent);
  };

  const charCount = content.length;
  const isTwitter = draft.platform === 'twitter';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Edit {isTwitter ? 'Twitter Thread' : 'LinkedIn Post'}
          </h2>
          <button
            onClick={onCancel}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-auto">
          {isTwitter && (
            <p className="text-sm text-[var(--color-text-muted)] mb-3">
              Separate tweets with blank lines. Each tweet must be 280 characters or less.
            </p>
          )}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-64 p-4 border border-[var(--color-border)] rounded-lg text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            placeholder={
              isTwitter
                ? 'Enter tweets separated by blank lines...'
                : 'Enter LinkedIn post content...'
            }
          />
          <div className="mt-2 text-xs text-[var(--color-text-muted)]">
            {charCount} characters
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--color-border)] flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || content.trim().length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save & Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}
