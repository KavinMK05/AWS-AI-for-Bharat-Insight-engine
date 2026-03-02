// ============================================================================
// TwitterPreview — Renders tweet thread in Twitter-like styling
// ============================================================================

interface TwitterPreviewProps {
  content: string;
}

export function TwitterPreview({ content }: TwitterPreviewProps) {
  let tweets: string[];
  try {
    tweets = JSON.parse(content) as string[];
  } catch {
    tweets = [content];
  }

  if (!Array.isArray(tweets)) {
    tweets = [String(tweets)];
  }

  return (
    <div className="space-y-0">
      {tweets.map((tweet, index) => (
        <div
          key={index}
          className={`relative border border-[var(--color-border)] bg-white p-4 ${
            index === 0 ? 'rounded-t-lg' : ''
          } ${index === tweets.length - 1 ? 'rounded-b-lg' : ''} ${
            index > 0 ? 'border-t-0' : ''
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-twitter)] flex items-center justify-center text-white text-sm font-bold">
              IE
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">Insight Engine</span>
                <span className="text-[var(--color-text-muted)] text-sm">@insight_engine</span>
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap break-words">{tweet}</p>
              <div className="mt-2 flex items-center justify-between text-[var(--color-text-muted)] text-xs">
                <span>{tweet.length}/280 chars</span>
                <span className={tweet.length > 280 ? 'text-red-500 font-bold' : ''}>
                  {index + 1}/{tweets.length}
                </span>
              </div>
            </div>
          </div>
          {index < tweets.length - 1 && (
            <div className="absolute left-7 bottom-0 w-0.5 h-4 bg-gray-200 translate-y-full z-10" />
          )}
        </div>
      ))}
    </div>
  );
}
