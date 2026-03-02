// ============================================================================
// LinkedInPreview — Renders LinkedIn post in LinkedIn-like card styling
// ============================================================================

interface LinkedInPreviewProps {
  content: string;
}

export function LinkedInPreview({ content }: LinkedInPreviewProps) {
  let postText: string;
  try {
    const parsed = JSON.parse(content);
    postText = typeof parsed === 'string' ? parsed : String(parsed);
  } catch {
    postText = content;
  }

  return (
    <div className="border border-[var(--color-border)] bg-white rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-center gap-3">
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[var(--color-linkedin)] flex items-center justify-center text-white text-sm font-bold">
          IE
        </div>
        <div>
          <div className="font-semibold text-sm">Insight Engine</div>
          <div className="text-xs text-[var(--color-text-muted)]">
            AI Content Pipeline
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">Just now</div>
        </div>
      </div>

      {/* Post content */}
      <div className="px-4 pb-4">
        <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
          {postText}
        </p>
      </div>

      {/* Character count */}
      <div className="px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-surface-alt)]">
        <span
          className={`text-xs ${
            postText.length >= 1300 && postText.length <= 2000
              ? 'text-green-600'
              : 'text-red-500 font-bold'
          }`}
        >
          {postText.length}/2000 chars
          {postText.length < 1300 && ' (below 1300 minimum)'}
          {postText.length > 2000 && ' (exceeds 2000 limit)'}
        </span>
      </div>

      {/* Engagement bar */}
      <div className="px-4 py-3 border-t border-[var(--color-border)] flex gap-6 text-xs text-[var(--color-text-muted)]">
        <span>Like</span>
        <span>Comment</span>
        <span>Repost</span>
        <span>Send</span>
      </div>
    </div>
  );
}
