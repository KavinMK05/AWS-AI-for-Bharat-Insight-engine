// ============================================================================
// ApprovalActions — Approve/Reject/Edit buttons with loading states
// ============================================================================

'use client';

import { useState } from 'react';
import type { DraftContent } from '@/lib/types';
import { approveDraft, rejectDraft, editAndApproveDraft } from '@/lib/api';
import { EditModal } from './edit-modal';

interface ApprovalActionsProps {
  draft: DraftContent;
  onAction: (draftId: string, action: 'approved' | 'rejected') => void;
  onError: (message: string) => void;
}

export function ApprovalActions({ draft, onAction, onError }: ApprovalActionsProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  const handleApprove = async () => {
    setLoading('approve');
    try {
      await approveDraft(draft.id);
      onAction(draft.id, 'approved');
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setLoading(null);
    }
  };

  const handleReject = async () => {
    setLoading('reject');
    try {
      await rejectDraft(draft.id);
      onAction(draft.id, 'rejected');
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setLoading(null);
    }
  };

  const handleEditSave = async (editedContent: string) => {
    setLoading('edit');
    try {
      await editAndApproveDraft(draft.id, editedContent);
      setShowEditModal(false);
      onAction(draft.id, 'approved');
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed to save edit');
    } finally {
      setLoading(null);
    }
  };

  const isDisabled = loading !== null;

  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={isDisabled}
          className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-success)] hover:bg-green-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === 'approve' ? 'Approving...' : 'Approve'}
        </button>
        <button
          onClick={handleReject}
          disabled={isDisabled}
          className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-danger)] hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === 'reject' ? 'Rejecting...' : 'Reject'}
        </button>
        <button
          onClick={() => setShowEditModal(true)}
          disabled={isDisabled}
          className="px-4 py-2 text-sm font-medium text-[var(--color-text)] bg-white border border-[var(--color-border)] hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Edit
        </button>
      </div>

      {showEditModal && (
        <EditModal
          draft={draft}
          onSave={handleEditSave}
          onCancel={() => setShowEditModal(false)}
        />
      )}
    </>
  );
}
