# Design Document: The Insight Engine

## Overview

The Insight Engine is a multi-component autonomous system that transforms high-signal information into platform-specific thought leadership content. The architecture follows a pipeline pattern with four main stages: ingestion (Watchtower), analysis (Analyst), content generation (Ghostwriter), and human approval (Gatekeeper). The system uses LLM APIs for intelligent filtering and content generation, a database for persistence, and platform APIs for publishing.

The design emphasizes modularity, allowing each component to operate independently and be replaced or upgraded without affecting others. The system operates on a scheduled basis, with configurable intervals for monitoring, analysis, and digest delivery.

## Architecture

### High-Level Architecture

```mermaid
graph TB
    subgraph "Ingestion Layer"
        RSS[RSS Feeds]
        ARXIV[arXiv API]
        SOCIAL[Social Media APIs]
        WATCHTOWER[Watchtower]
    end
    
    subgraph "Analysis Layer"
        ANALYST[Analyst]
        LLM1[LLM API - Scoring]
        LLM2[LLM API - Hot Takes]
    end
    
    subgraph "Generation Layer"
        GHOSTWRITER[Ghostwriter]
        LLM3[LLM API - Content Gen]
    end
    
    subgraph "Approval Layer"
        GATEKEEPER[Gatekeeper]
        EMAIL[Email Service]
        WEB[Web Interface]
    end
    
    subgraph "Publishing Layer"
        PUBLISHER[Publisher]
        TWITTER[Twitter/Typefully API]
        LINKEDIN[LinkedIn/Buffer API]
        MEDIUM[Medium API]
    end
    
    subgraph "Storage Layer"
        DB[(Database)]
    end
    
    subgraph "Configuration"
        PERSONA[Persona File]
        CONFIG[System Config]
    end
    
    RSS --> WATCHTOWER
    ARXIV --> WATCHTOWER
    SOCIAL --> WATCHTOWER
    WATCHTOWER --> DB
    
    DB --> ANALYST
    PERSONA --> ANALYST
    ANALYST --> LLM1
    ANALYST --> LLM2
    ANALYST --> DB
    
    DB --> GHOSTWRITER
    PERSONA --> GHOSTWRITER
    GHOSTWRITER --> LLM3
    GHOSTWRITER --> DB
    
    DB --> GATEKEEPER
    GATEKEEPER --> EMAIL
    GATEKEEPER --> WEB
    GATEKEEPER --> DB
    
    DB --> PUBLISHER
    PUBLISHER --> TWITTER
    PUBLISHER --> LINKEDIN
    PUBLISHER --> MEDIUM
    PUBLISHER --> DB
    
    CONFIG --> WATCHTOWER
    CONFIG --> ANALYST
    CONFIG --> GATEKEEPER
    CONFIG --> PUBLISHER
```

### Component Interaction Flow

1. **Watchtower** polls external sources on schedule → stores raw content in database
2. **Analyst** processes unscored content → generates relevance scores and hot takes → stores in database
3. **Ghostwriter** processes approved hot takes → generates platform-specific drafts → stores in database
4. **Gatekeeper** compiles digest on schedule → presents to user → updates approval status in database
5. **Publisher** processes approved content → publishes to platforms → updates publication status in database

### Deployment Architecture

The system can be deployed in two modes:

**Serverless Mode:**
- Each component runs as a separate cloud function (AWS Lambda, Google Cloud Functions)
- Triggered by scheduled events (CloudWatch Events, Cloud Scheduler)
- Database hosted as managed service (Supabase, AWS RDS)
- Stateless execution with all state in database

**Long-Running Mode:**
- Single process with internal scheduler (APScheduler, node-cron)
- Components run as modules within the same process
- Database can be local (SQLite) or remote (PostgreSQL)
- Suitable for local development or VPS deployment

## Components and Interfaces

### 1. Watchtower (Ingestion Layer)

**Responsibility:** Monitor external sources and ingest new content

**Interfaces:**

```typescript
interface ContentSource {
  type: 'rss' | 'arxiv' | 'social';
  url: string;
  category?: string;
  enabled: boolean;
}

interface RawContent {
  id: string;
  source_type: string;
  source_url: string;
  title: string;
  author: string;
  published_at: Date;
  content_text: string;
  metadata: Record<string, any>;
  ingested_at: Date;
}

interface Watchtower {
  // Monitor all enabled sources and ingest new content
  monitor(): Promise<RawContent[]>;
  
  // Monitor a specific source
  monitorSource(source: ContentSource): Promise<RawContent[]>;
  
  // Check if content already exists (deduplication)
  isDuplicate(content: RawContent): Promise<boolean>;
  
  // Store raw content in database
  storeContent(content: RawContent): Promise<void>;
}
```

**Implementation Details:**

- **RSS Monitoring:** Use `feedparser` (Python) or `rss-parser` (Node.js) to parse RSS/Atom feeds
- **arXiv Monitoring:** Use arXiv API with query parameters for categories (cs.AI, cs.LG, etc.)
- **Social Monitoring:** Use platform APIs (Twitter API v2, Reddit API) with keyword/hashtag filters
- **Deduplication:** Hash content URLs and check against database before storing
- **Error Handling:** Log failures per source, continue with other sources
- **Rate Limiting:** Respect source rate limits, implement exponential backoff

### 2. Persona Manager

**Responsibility:** Load and provide access to persona configuration

**Interfaces:**

```typescript
interface PersonaFile {
  name: string;
  tone: {
    style: 'formal' | 'casual' | 'technical' | 'humorous';
    voice_description: string;
    example_phrases: string[];
  };
  topics: {
    primary: string[];
    secondary: string[];
    avoid: string[];
  };
  heroes: Array<{
    name: string;
    reason: string;
  }>;
  enemies: Array<{
    name: string;
    reason: string;
  }>;
  platforms: {
    twitter: {
      max_thread_length: number;
      use_hashtags: boolean;
      use_emojis: boolean;
      preferred_hashtags: string[];
    };
    linkedin: {
      tone_adjustment: string;
      use_hashtags: boolean;
    };
    medium: {
      article_length: 'short' | 'medium' | 'long';
      include_images: boolean;
    };
  };
}

interface PersonaManager {
  // Load persona from file
  loadPersona(filepath: string): Promise<PersonaFile>;
  
  // Validate persona structure
  validatePersona(persona: PersonaFile): ValidationResult;
  
  // Get persona for use by other components
  getPersona(): PersonaFile;
  
  // Generate LLM system prompt from persona
  generateSystemPrompt(context: 'scoring' | 'hottake' | 'content'): string;
}
```

**Implementation Details:**

- **File Format:** JSON or YAML for easy editing
- **Validation:** JSON Schema validation for required fields
- **System Prompt Generation:** Convert persona into LLM system prompts that enforce tone and style
- **Caching:** Load once at startup, reload on file change (optional)

### 3. Analyst (Filtering & Scoring Layer)

**Responsibility:** Score content relevance and generate hot takes

**Interfaces:**

```typescript
interface RelevanceScore {
  content_id: string;
  score: number; // 0-100
  reasoning: string;
  topics_matched: string[];
  scored_at: Date;
}

interface HotTake {
  id: string;
  content_id: string;
  take_text: string;
  variation_number: number;
  generated_at: Date;
}

interface Analyst {
  // Score a single content item for relevance
  scoreContent(content: RawContent, persona: PersonaFile): Promise<RelevanceScore>;
  
  // Generate hot takes for high-scoring content
  generateHotTakes(
    content: RawContent,
    score: RelevanceScore,
    persona: PersonaFile,
    count: number
  ): Promise<HotTake[]>;
  
  // Process all unscored content in batch
  processBatch(threshold: number): Promise<void>;
  
  // Identify trending topics across recent content
  identifyTrends(timeWindow: Duration): Promise<string[]>;
}
```

**Implementation Details:**

- **Scoring Prompt:** LLM prompt that evaluates content against persona topics, heroes, enemies
- **Scoring Output:** Structured JSON with score (0-100) and reasoning
- **Hot Take Prompt:** LLM prompt that generates commentary in persona voice
- **Variation Generation:** Request multiple completions with temperature > 0.7 for diversity
- **Batch Processing:** Process all content with `relevance_score IS NULL`
- **Trend Detection:** Aggregate topics from high-scoring content, identify clusters

**LLM Prompt Templates:**

*Scoring Prompt:*
```
You are evaluating content for relevance to a specific persona.

Persona Topics: {primary_topics}
Persona Heroes: {heroes}
Persona Enemies: {enemies}

Content:
Title: {title}
Author: {author}
Text: {content_text}

Rate this content's relevance (0-100) and explain your reasoning.
Output JSON: {"score": <number>, "reasoning": "<string>", "topics_matched": [<strings>]}
```

*Hot Take Prompt:*
```
You are {persona_name}, a thought leader with the following voice:
{voice_description}

Generate an insightful commentary (50-300 words) on this content:
Title: {title}
Summary: {content_text}

Your take should:
- Reflect your tone: {tone_style}
- Reference relevant heroes/enemies if appropriate
- Provide unique insight, not just summary
- Use phrases like: {example_phrases}

Generate {count} different variations.
```

### 4. Ghostwriter (Content Generation Layer)

**Responsibility:** Transform hot takes into platform-specific content

**Interfaces:**

```typescript
interface DraftContent {
  id: string;
  hot_take_id: string;
  platform: 'twitter' | 'linkedin' | 'medium';
  content_text: string;
  metadata: {
    thread_count?: number; // for Twitter
    hashtags?: string[];
    word_count?: number;
  };
  status: 'pending' | 'approved' | 'rejected' | 'edited' | 'published';
  generated_at: Date;
  approved_at?: Date;
  published_at?: Date;
}

interface Ghostwriter {
  // Generate Twitter thread from hot take
  generateTwitterThread(
    hotTake: HotTake,
    content: RawContent,
    persona: PersonaFile
  ): Promise<DraftContent>;
  
  // Generate LinkedIn post from hot take
  generateLinkedInPost(
    hotTake: HotTake,
    content: RawContent,
    persona: PersonaFile
  ): Promise<DraftContent>;
  
  // Generate Medium article from hot take
  generateMediumArticle(
    hotTake: HotTake,
    content: RawContent,
    persona: PersonaFile
  ): Promise<DraftContent>;
  
  // Generate all platform variants for a hot take
  generateAllPlatforms(
    hotTake: HotTake,
    content: RawContent,
    persona: PersonaFile
  ): Promise<DraftContent[]>;
}
```

**Implementation Details:**

- **Platform-Specific Prompts:** Each platform has unique formatting requirements
- **Twitter:** Break into 280-char tweets, number threads (1/n), include source link in final tweet
- **LinkedIn:** 1300-2000 chars, professional tone adjustment, strategic hashtag placement
- **Medium:** Full article with H2/H3 headers, introduction, body, conclusion, source attribution
- **Source Attribution:** Always include link to original content
- **Hashtag Injection:** Use persona preferences for hashtag placement and selection

**LLM Prompt Templates:**

*Twitter Thread Prompt:*
```
You are {persona_name}. Transform this hot take into a Twitter thread.

Hot Take: {hot_take_text}
Source: {content_title} by {content_author}

Requirements:
- Maximum 280 characters per tweet
- Number tweets (1/n, 2/n, etc.)
- Use {persona_tone} tone
- Include hashtags: {preferred_hashtags} (if use_hashtags=true)
- Include emojis sparingly (if use_emojis=true)
- Final tweet includes source link: {source_url}
- Maximum {max_thread_length} tweets

Output as JSON array of tweet strings.
```

*LinkedIn Post Prompt:*
```
You are {persona_name}. Transform this hot take into a LinkedIn post.

Hot Take: {hot_take_text}
Source: {content_title} by {content_author}

Requirements:
- 1300-2000 characters
- Professional tone (adjust from: {persona_tone})
- Include 2-3 relevant hashtags at end (if use_hashtags=true)
- Include source attribution with link
- Use line breaks for readability
- Hook in first 2 lines

Output as single string.
```

*Medium Article Prompt:*
```
You are {persona_name}. Expand this hot take into a Medium article.

Hot Take: {hot_take_text}
Source: {content_title} by {content_author}
Source URL: {source_url}

Requirements:
- {article_length} length (short=800-1200, medium=1200-1600, long=1600-2000 words)
- Include H2 section headers
- Structure: Introduction, 2-3 body sections, Conclusion
- Maintain {persona_tone} tone
- Include source attribution in introduction
- End with call-to-action or reflection

Output as Markdown.
```

### 5. Gatekeeper (Approval Interface)

**Responsibility:** Present drafts to user and collect approval decisions

**Interfaces:**

```typescript
interface ApprovalDigest {
  id: string;
  generated_at: Date;
  items: ApprovalDigestItem[];
  status: 'pending' | 'reviewed';
}

interface ApprovalDigestItem {
  content: RawContent;
  hot_take: HotTake;
  drafts: DraftContent[];
  relevance_score: RelevanceScore;
}

interface ApprovalDecision {
  draft_id: string;
  action: 'approve' | 'reject' | 'edit';
  edited_text?: string;
  schedule_time?: Date;
}

interface Gatekeeper {
  // Generate digest of pending drafts
  generateDigest(): Promise<ApprovalDigest>;
  
  // Send digest via email
  sendDigestEmail(digest: ApprovalDigest, recipient: string): Promise<void>;
  
  // Render digest as HTML for web interface
  renderDigestHTML(digest: ApprovalDigest): string;
  
  // Process user decisions
  processDecisions(decisions: ApprovalDecision[]): Promise<void>;
  
  // Get pending drafts count
  getPendingCount(): Promise<number>;
}
```

**Implementation Details:**

- **Digest Generation:** Query database for all drafts with `status='pending'`
- **Email Delivery:** Use SendGrid, AWS SES, or similar service
- **Email Format:** HTML email with original content, hot take, and all platform drafts
- **Web Interface:** Simple React/Vue app or server-rendered HTML with approval buttons
- **Decision Processing:** Update draft status in database, add to publishing queue if approved
- **Edit Handling:** Store edited text, mark as `status='edited'`, preserve original

**Email Template Structure:**
```html
<div class="digest-item">
  <h2>Original Content</h2>
  <p><strong>Title:</strong> {title}</p>
  <p><strong>Source:</strong> {source_url}</p>
  <p><strong>Relevance Score:</strong> {score}/100</p>
  <p>{content_summary}</p>
  
  <h3>Your Hot Take</h3>
  <p>{hot_take_text}</p>
  
  <h3>Twitter Thread</h3>
  <div class="draft">{twitter_draft}</div>
  <button>Approve</button> <button>Reject</button> <button>Edit</button>
  
  <h3>LinkedIn Post</h3>
  <div class="draft">{linkedin_draft}</div>
  <button>Approve</button> <button>Reject</button> <button>Edit</button>
  
  <h3>Medium Article</h3>
  <div class="draft">{medium_draft}</div>
  <button>Approve</button> <button>Reject</button> <button>Edit</button>
</div>
```

### 6. Publisher (Publishing Layer)

**Responsibility:** Publish approved content to platforms

**Interfaces:**

```typescript
interface PublishResult {
  draft_id: string;
  platform: string;
  success: boolean;
  platform_url?: string;
  error?: string;
  published_at?: Date;
}

interface Publisher {
  // Publish a single draft to its platform
  publishDraft(draft: DraftContent): Promise<PublishResult>;
  
  // Publish all approved drafts in queue
  publishQueue(): Promise<PublishResult[]>;
  
  // Check if platform rate limits allow publishing
  canPublish(platform: string): Promise<boolean>;
  
  // Schedule draft for future publication
  scheduleDraft(draft: DraftContent, publishAt: Date): Promise<void>;
}

interface PlatformAdapter {
  // Publish content to specific platform
  publish(content: string, metadata: Record<string, any>): Promise<string>;
  
  // Check rate limit status
  checkRateLimit(): Promise<boolean>;
}
```

**Implementation Details:**

- **Platform Adapters:** Separate adapter for each platform (Twitter, LinkedIn, Medium)
- **Twitter Adapter:** Use Twitter API v2 or Typefully API for thread posting
- **LinkedIn Adapter:** Use LinkedIn API or Buffer API for post creation
- **Medium Adapter:** Use Medium API for article publication
- **Rate Limiting:** Track last publish time per platform, enforce minimum spacing (1 hour)
- **Retry Logic:** Exponential backoff (1s, 2s, 4s) for transient failures
- **Error Handling:** Log failures, notify user, keep in queue for manual retry

**Platform Adapter Implementations:**

*Twitter Adapter (using Typefully):*
```typescript
class TypefullyAdapter implements PlatformAdapter {
  async publish(content: string, metadata: any): Promise<string> {
    // Parse thread from content (array of tweets)
    const tweets = JSON.parse(content);
    
    // Create draft in Typefully
    const response = await fetch('https://api.typefully.com/v1/drafts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TYPEFULLY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: tweets.join('\n\n'),
        schedule: 'now'
      })
    });
    
    const data = await response.json();
    return data.url;
  }
  
  async checkRateLimit(): Promise<boolean> {
    // Check last publish time from database
    const lastPublish = await getLastPublishTime('twitter');
    const hoursSince = (Date.now() - lastPublish) / (1000 * 60 * 60);
    return hoursSince >= 1;
  }
}
```

*LinkedIn Adapter (using Buffer):*
```typescript
class BufferLinkedInAdapter implements PlatformAdapter {
  async publish(content: string, metadata: any): Promise<string> {
    const response = await fetch('https://api.bufferapp.com/1/updates/create.json', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.BUFFER_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        profile_ids: [process.env.LINKEDIN_PROFILE_ID],
        text: content,
        now: true
      })
    });
    
    const data = await response.json();
    return data.updates[0].url;
  }
  
  async checkRateLimit(): Promise<boolean> {
    const lastPublish = await getLastPublishTime('linkedin');
    const hoursSince = (Date.now() - lastPublish) / (1000 * 60 * 60);
    return hoursSince >= 1;
  }
}
```

*Medium Adapter:*
```typescript
class MediumAdapter implements PlatformAdapter {
  async publish(content: string, metadata: any): Promise<string> {
    // Get user ID first
    const userResponse = await fetch('https://api.medium.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${process.env.MEDIUM_ACCESS_TOKEN}`
      }
    });
    const userData = await userResponse.json();
    
    // Publish article
    const response = await fetch(
      `https://api.medium.com/v1/users/${userData.data.id}/posts`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.MEDIUM_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: metadata.title,
          contentFormat: 'markdown',
          content: content,
          publishStatus: 'public'
        })
      }
    );
    
    const data = await response.json();
    return data.data.url;
  }
  
  async checkRateLimit(): Promise<boolean> {
    const lastPublish = await getLastPublishTime('medium');
    const hoursSince = (Date.now() - lastPublish) / (1000 * 60 * 60);
    return hoursSince >= 1;
  }
}
```

### 7. Database Layer

**Responsibility:** Persist all system data

**Schema:**

```sql
-- Raw ingested content
CREATE TABLE content_items (
  id UUID PRIMARY KEY,
  source_type VARCHAR(50) NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author VARCHAR(255),
  published_at TIMESTAMP,
  content_text TEXT NOT NULL,
  metadata JSONB,
  ingested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_source_type (source_type),
  INDEX idx_ingested_at (ingested_at)
);

-- Relevance scores
CREATE TABLE relevance_scores (
  id UUID PRIMARY KEY,
  content_id UUID NOT NULL REFERENCES content_items(id),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  reasoning TEXT,
  topics_matched TEXT[],
  scored_at TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_content_id (content_id),
  INDEX idx_score (score)
);

-- Generated hot takes
CREATE TABLE hot_takes (
  id UUID PRIMARY KEY,
  content_id UUID NOT NULL REFERENCES content_items(id),
  take_text TEXT NOT NULL,
  variation_number INTEGER NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_content_id (content_id)
);

-- Platform-specific drafts
CREATE TABLE draft_content (
  id UUID PRIMARY KEY,
  hot_take_id UUID NOT NULL REFERENCES hot_takes(id),
  platform VARCHAR(50) NOT NULL,
  content_text TEXT NOT NULL,
  metadata JSONB,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMP,
  published_at TIMESTAMP,
  platform_url TEXT,
  INDEX idx_hot_take_id (hot_take_id),
  INDEX idx_status (status),
  INDEX idx_platform (platform)
);

-- Approval digests
CREATE TABLE approval_digests (
  id UUID PRIMARY KEY,
  generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMP,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  INDEX idx_status (status)
);

-- Publishing queue
CREATE TABLE publishing_queue (
  id UUID PRIMARY KEY,
  draft_id UUID NOT NULL REFERENCES draft_content(id),
  scheduled_for TIMESTAMP NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_scheduled_for (scheduled_for),
  INDEX idx_draft_id (draft_id)
);

-- System metrics
CREATE TABLE metrics (
  id UUID PRIMARY KEY,
  metric_name VARCHAR(100) NOT NULL,
  metric_value NUMERIC NOT NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB,
  INDEX idx_metric_name (metric_name),
  INDEX idx_recorded_at (recorded_at)
);
```

## Data Models

### Core Data Flow

```
RawContent → RelevanceScore → HotTake → DraftContent → PublishResult
```

### State Transitions

**DraftContent Status:**
```
pending → approved → published
pending → rejected (terminal)
pending → edited → published
```

### Data Retention

- **Content Items:** Retain indefinitely for historical analysis
- **Relevance Scores:** Retain indefinitely
- **Hot Takes:** Retain indefinitely
- **Draft Content:** Retain for 90 days after publication/rejection
- **Metrics:** Retain for 1 year

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: Content Metadata Completeness
*For any* content item ingested by the Watchtower, all required metadata fields (title, author, publication date, source URL, full text) should be present and non-empty.
**Validates: Requirements 1.4**

### Property 2: Error Isolation in Ingestion
*For any* set of content sources where one source fails, the Watchtower should continue processing all other sources successfully.
**Validates: Requirements 1.5**

### Property 3: Content Persistence Round Trip
*For any* content item ingested, querying the database should return that item with its timestamp and source attribution intact.
**Validates: Requirements 1.6**

### Property 4: Persona Schema Validation
*For any* persona file missing required fields (tone, topics, heroes, enemies, platform preferences), the system should reject it with a descriptive error message.
**Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**

### Property 5: Relevance Score Assignment
*For any* content item processed by the Analyst, it should be assigned a relevance score between 0 and 100.
**Validates: Requirements 3.1**

### Property 6: Score-Based Filtering
*For any* relevance threshold value, all content items with scores below that threshold should be filtered out from further processing.
**Validates: Requirements 3.2**

### Property 7: Trending Topic Detection
*For any* set of content items where a topic appears in multiple items, the trend detection should identify that topic.
**Validates: Requirements 3.4**

### Property 8: Scoring Error Handling
*For any* content item that causes scoring to fail, the assigned relevance score should be zero and an error should be logged.
**Validates: Requirements 3.5**

### Property 9: Hot Take Generation for High-Scoring Content
*For any* content item with a relevance score above the threshold, at least one hot take should be generated.
**Validates: Requirements 4.1**

### Property 10: Hot Take Length Constraints
*For any* generated hot take, the word count should be between 50 and 300 words inclusive.
**Validates: Requirements 4.4**

### Property 11: Hot Take Variation Count
*For any* high-scoring content item, at least 2 hot take variations should be generated.
**Validates: Requirements 4.5**

### Property 12: Twitter Thread Format Compliance
*For any* generated Twitter thread, each tweet should be at most 280 characters, and tweets should be numbered sequentially (1/n, 2/n, etc.).
**Validates: Requirements 5.1**

### Property 13: LinkedIn Post Length Compliance
*For any* generated LinkedIn post, the character count should be between 1300 and 2000 characters inclusive.
**Validates: Requirements 5.2**

### Property 14: Medium Article Format Compliance
*For any* generated Medium article, the word count should be between 800 and 2000 words, and it should contain at least one header (H2 or H3).
**Validates: Requirements 5.3**

### Property 15: Platform Preference Application
*For any* draft content where the persona file specifies hashtag usage, the generated content should contain at least one hashtag from the preferred list.
**Validates: Requirements 5.4**

### Property 16: Source Attribution Presence
*For any* generated draft content, it should contain the source URL of the original content item.
**Validates: Requirements 5.5**

### Property 17: Approval Digest Completeness
*For any* generated approval digest, it should contain the original content item, hot take, and all platform-specific drafts for each included item.
**Validates: Requirements 6.2**

### Property 18: Approved Content Queuing
*For any* draft content that is approved, it should appear in the publishing queue with status 'approved'.
**Validates: Requirements 6.4**

### Property 19: Edited Content Preservation
*For any* draft content that is edited, the edited version should be saved to the database and added to the publishing queue.
**Validates: Requirements 6.5**

### Property 20: Rejected Content Exclusion
*For any* draft content that is rejected, it should not appear in any subsequent approval digests.
**Validates: Requirements 6.6**

### Property 21: Approved Content Scheduling
*For any* approved draft content, it should be scheduled for publication with a future timestamp.
**Validates: Requirements 7.1**

### Property 22: Publishing Retry Behavior
*For any* publishing attempt that fails, the system should retry exactly 3 times before marking it as failed.
**Validates: Requirements 7.5**

### Property 23: Failed Content Persistence
*For any* draft content that fails publishing after all retries, it should remain in the publishing queue and trigger a user notification.
**Validates: Requirements 7.6**

### Property 24: Platform Rate Limiting
*For any* two consecutive posts to the same platform, the time difference should be at least 1 hour.
**Validates: Requirements 7.7**

### Property 25: Data Relationship Integrity
*For any* hot take stored in the database, querying should return its linked source content item.
**Validates: Requirements 8.2**

### Property 26: Draft Status Persistence
*For any* draft content, querying the database should return its current approval status and all associated timestamps.
**Validates: Requirements 8.3**

### Property 27: Published Content Metadata
*For any* published content, querying the database should return its publication timestamp and platform URL.
**Validates: Requirements 8.4**

### Property 28: Duplicate Content Detection
*For any* content item that has similar title and content to a previously processed item, it should be flagged as a potential duplicate.
**Validates: Requirements 8.5**

### Property 29: Historical Content Query
*For any* query by date range, topic, or platform, the results should only include content matching all specified criteria.
**Validates: Requirements 8.6**

### Property 30: Error Logging Completeness
*For any* error that occurs in any component, a log entry should be created containing timestamp, component name, and error details.
**Validates: Requirements 9.1**

### Property 31: Non-Critical Error Resilience
*For any* non-critical error (ingestion failure, scoring failure), the system should continue processing remaining items in the batch.
**Validates: Requirements 9.2**

### Property 32: Critical Error Notification
*For any* critical error (database unavailable, API authentication failure), an administrator notification should be sent.
**Validates: Requirements 9.3**

### Property 33: Metrics Recording
*For any* system operation (content ingestion, hot take generation, content publication), corresponding metrics should be recorded in the database.
**Validates: Requirements 9.4**

### Property 34: Configuration Validation
*For any* invalid configuration value (negative intervals, out-of-range thresholds, invalid schedules), the system should reject it at startup with a descriptive error.
**Validates: Requirements 10.2, 10.3, 10.4, 10.5**

## Error Handling

### Error Categories

**Non-Critical Errors (Continue Operation):**
- Individual source ingestion failures
- Individual content scoring failures
- Individual hot take generation failures
- Individual draft generation failures
- Publishing failures (with retry)

**Critical Errors (Halt Operation):**
- Database connection failures
- API authentication failures (LLM, publishing platforms)
- Invalid persona file at startup
- Invalid system configuration at startup

### Error Handling Strategy

1. **Graceful Degradation:** Non-critical errors should not stop the entire pipeline
2. **Detailed Logging:** All errors logged with context (component, operation, input data)
3. **User Notification:** Critical errors and repeated failures trigger notifications
4. **Retry Logic:** Transient failures (API rate limits, network issues) use exponential backoff
5. **Error Metrics:** Track error rates per component for monitoring

### Error Response Patterns

```typescript
interface ErrorResult {
  success: false;
  error: {
    code: string;
    message: string;
    component: string;
    timestamp: Date;
    details?: any;
  };
}

interface SuccessResult<T> {
  success: true;
  data: T;
}

type Result<T> = SuccessResult<T> | ErrorResult;
```

### Logging Strategy

- **Structured Logging:** JSON format for easy parsing
- **Log Levels:** DEBUG, INFO, WARN, ERROR, CRITICAL
- **Context Propagation:** Include request/batch IDs for tracing
- **Sensitive Data:** Redact API keys and user content in logs

## Testing Strategy

### Dual Testing Approach

The Insight Engine requires both unit tests and property-based tests for comprehensive coverage:

- **Unit tests** verify specific examples, edge cases, and integration points
- **Property tests** verify universal properties across all inputs
- Both approaches are complementary and necessary

### Unit Testing Focus

Unit tests should cover:
- Specific examples of content ingestion from each source type (RSS, arXiv, social)
- Integration with external APIs (mocked)
- Edge cases: empty content, malformed data, missing fields
- Error conditions: API failures, network timeouts, invalid responses
- Database operations: CRUD operations, query correctness
- Platform adapter functionality with mocked API responses

### Property-Based Testing Focus

Property tests should cover all 34 correctness properties defined above. Each property test should:
- Run minimum 100 iterations with randomized inputs
- Reference its design document property in a comment
- Use tag format: **Feature: insight-engine, Property {number}: {property_text}**

### Property-Based Testing Library

**Recommended Libraries by Language:**
- **Python:** Hypothesis
- **TypeScript/JavaScript:** fast-check
- **Java:** jqwik
- **Go:** gopter

### Test Data Generation

Property tests require generators for:
- **Content Items:** Random titles, authors, text, URLs, timestamps
- **Persona Files:** Valid and invalid configurations with random values
- **Hot Takes:** Random text with varying word counts
- **Draft Content:** Random platform-specific content with varying formats
- **Timestamps:** Random dates within reasonable ranges
- **Scores:** Random integers 0-100

### Example Property Test (Python with Hypothesis)

```python
from hypothesis import given, strategies as st
import pytest

# Feature: insight-engine, Property 10: Hot Take Length Constraints
@given(st.text(min_size=1))
def test_hot_take_length_constraints(content_text):
    """
    For any generated hot take, the word count should be 
    between 50 and 300 words inclusive.
    """
    # Arrange
    content = create_test_content(content_text)
    persona = load_test_persona()
    analyst = Analyst(llm_client=mock_llm)
    
    # Act
    hot_takes = analyst.generate_hot_takes(content, persona, count=1)
    
    # Assert
    for hot_take in hot_takes:
        word_count = len(hot_take.take_text.split())
        assert 50 <= word_count <= 300, \
            f"Hot take has {word_count} words, expected 50-300"
```

### Example Property Test (TypeScript with fast-check)

```typescript
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

// Feature: insight-engine, Property 12: Twitter Thread Format Compliance
describe('Twitter Thread Generation', () => {
  it('should generate threads with valid tweet lengths', () => {
    fc.assert(
      fc.property(
        fc.record({
          text: fc.string({ minLength: 100, maxLength: 5000 }),
          title: fc.string({ minLength: 10, maxLength: 200 }),
        }),
        async (hotTake) => {
          // Arrange
          const ghostwriter = new Ghostwriter(mockLLM);
          const persona = loadTestPersona();
          
          // Act
          const draft = await ghostwriter.generateTwitterThread(
            hotTake,
            mockContent,
            persona
          );
          
          // Assert
          const tweets = JSON.parse(draft.content_text);
          for (const tweet of tweets) {
            expect(tweet.length).toBeLessThanOrEqual(280);
          }
          
          // Check numbering
          for (let i = 0; i < tweets.length; i++) {
            const expectedNumber = `${i + 1}/${tweets.length}`;
            expect(tweets[i]).toContain(expectedNumber);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Integration Testing

Integration tests should verify:
- End-to-end pipeline: ingestion → scoring → hot take → draft → approval → publishing
- Database transactions and rollbacks
- External API integrations (with test accounts)
- Email delivery (with test recipients)
- Scheduling and timing behavior

### Testing LLM Components

LLM-based components (Analyst, Ghostwriter) present unique testing challenges:

**Approach 1: Mock LLM Responses**
- Use deterministic mock responses for property tests
- Ensures tests are fast and reproducible
- Validates system behavior independent of LLM quality

**Approach 2: Real LLM with Assertions**
- Use real LLM API for integration tests
- Assert on structural properties (length, format, presence of elements)
- Don't assert on subjective quality (tone, style)

**Approach 3: Golden Tests**
- Store example LLM outputs as "golden" references
- Validate that system handles these outputs correctly
- Update golden files when LLM behavior changes

### Test Environment Setup

**Required Test Infrastructure:**
- Test database (SQLite for local, PostgreSQL for CI)
- Mock HTTP server for external APIs
- Test email service (Mailhog, Mailtrap)
- Test LLM API key (with rate limits)
- Test platform API credentials (sandbox accounts)

**Environment Variables for Testing:**
```bash
TEST_DATABASE_URL=sqlite:///test.db
TEST_LLM_API_KEY=test_key
TEST_TWITTER_API_KEY=test_key
TEST_LINKEDIN_API_KEY=test_key
TEST_MEDIUM_API_KEY=test_key
TEST_EMAIL_RECIPIENT=test@example.com
```

### Continuous Integration

CI pipeline should:
1. Run all unit tests
2. Run all property tests (100 iterations each)
3. Run integration tests (with mocked external services)
4. Generate coverage report (target: >80%)
5. Run linting and type checking
6. Build deployment artifacts

### Performance Testing

Performance tests should verify:
- Ingestion throughput: >100 items/minute
- Scoring latency: <5 seconds per item
- Hot take generation: <10 seconds per item
- Draft generation: <15 seconds per platform
- Database query performance: <100ms for common queries

### Manual Testing Checklist

Before deployment, manually verify:
- [ ] Persona file loads correctly
- [ ] Content ingestion from all sources works
- [ ] Approval digest email renders correctly
- [ ] Web interface displays all drafts
- [ ] Editing drafts preserves changes
- [ ] Publishing to each platform succeeds
- [ ] Error notifications are received
- [ ] Metrics dashboard shows correct data

## Deployment Considerations

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/insight_engine

# LLM API
LLM_PROVIDER=openai  # or anthropic
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o

# Content Sources
RSS_FEEDS=https://feed1.com/rss,https://feed2.com/rss
ARXIV_CATEGORIES=cs.AI,cs.LG
TWITTER_API_KEY=...
TWITTER_API_SECRET=...

# Publishing Platforms
TYPEFULLY_API_KEY=...
BUFFER_ACCESS_TOKEN=...
LINKEDIN_PROFILE_ID=...
MEDIUM_ACCESS_TOKEN=...

# Email
EMAIL_PROVIDER=sendgrid  # or ses
EMAIL_API_KEY=...
EMAIL_FROM=noreply@example.com
EMAIL_TO=user@example.com

# Configuration
PERSONA_FILE_PATH=/config/persona.json
MONITORING_INTERVAL=3600  # seconds
RELEVANCE_THRESHOLD=70
DIGEST_SCHEDULE=daily  # or twice-daily, weekly

# Deployment Mode
DEPLOYMENT_MODE=serverless  # or long-running
```

### Serverless Deployment (AWS Lambda)

**Architecture:**
- Separate Lambda functions for each component
- CloudWatch Events for scheduling
- RDS PostgreSQL for database
- S3 for persona file storage
- SES for email delivery

**Lambda Functions:**
1. `watchtower-monitor` (triggered hourly)
2. `analyst-process` (triggered by watchtower completion)
3. `ghostwriter-generate` (triggered by analyst completion)
4. `gatekeeper-digest` (triggered daily)
5. `publisher-publish` (triggered by approval)

**Deployment:**
```bash
# Package function
zip -r function.zip .

# Deploy with AWS CLI
aws lambda create-function \
  --function-name insight-engine-watchtower \
  --runtime python3.11 \
  --handler watchtower.handler \
  --zip-file fileb://function.zip \
  --role arn:aws:iam::ACCOUNT:role/lambda-role \
  --timeout 300 \
  --memory-size 512
```

### Long-Running Deployment (Docker)

**Dockerfile:**
```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

CMD ["python", "main.py"]
```

**Docker Compose:**
```yaml
version: '3.8'

services:
  insight-engine:
    build: .
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/insight_engine
      - LLM_API_KEY=${LLM_API_KEY}
      - PERSONA_FILE_PATH=/config/persona.json
    volumes:
      - ./config:/config
      - ./logs:/app/logs
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=insight_engine
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### Monitoring and Observability

**Metrics to Track:**
- Content items ingested per hour
- Average relevance score
- Hot takes generated per day
- Drafts approved vs rejected (approval rate)
- Posts published per platform
- Error rate per component
- LLM API latency and cost
- Database query performance

**Alerting Rules:**
- No content ingested in 2 hours
- Error rate >10% for any component
- Database connection failures
- LLM API authentication failures
- Publishing failures >3 consecutive attempts
- Approval rate <20% (may indicate poor relevance scoring)

### Cost Optimization

**LLM API Costs:**
- Use cheaper models for scoring (GPT-3.5, Claude Haiku)
- Use premium models for content generation (GPT-4, Claude Opus)
- Cache relevance scores to avoid re-scoring
- Batch API requests when possible

**Database Costs:**
- Archive old content items (>90 days) to cold storage
- Use database indexes for common queries
- Implement connection pooling

**Platform API Costs:**
- Use free tiers when available (Buffer, Typefully)
- Batch operations to minimize API calls
- Cache platform rate limit status

### Security Considerations

**API Key Management:**
- Store all API keys in environment variables or secrets manager
- Rotate keys regularly
- Use separate keys for dev/staging/production

**Data Privacy:**
- Don't log user content in plain text
- Encrypt database at rest
- Use HTTPS for all external API calls
- Implement rate limiting on web interface

**Access Control:**
- Require authentication for approval interface
- Use role-based access (admin, editor, viewer)
- Audit log for all approval decisions

### Backup and Recovery

**Database Backups:**
- Daily automated backups
- Retain backups for 30 days
- Test restore procedure monthly

**Configuration Backups:**
- Version control persona file
- Backup environment variables
- Document deployment procedure

**Disaster Recovery:**
- RTO (Recovery Time Objective): 4 hours
- RPO (Recovery Point Objective): 24 hours
- Maintain runbook for common failures

## Future Enhancements

### Phase 2 Features

1. **Multi-User Support:** Multiple personas with separate approval workflows
2. **Analytics Dashboard:** Track engagement metrics per platform
3. **A/B Testing:** Generate multiple variants and track performance
4. **Smart Scheduling:** Optimize posting times based on engagement data
5. **Content Calendar:** Visual calendar for scheduled posts
6. **Collaboration:** Team review and approval workflow
7. **Custom Sources:** User-defined RSS feeds and monitoring keywords
8. **Image Generation:** AI-generated images for posts
9. **Video Clips:** Generate short video clips from articles
10. **Cross-Posting:** Automatically adapt content across platforms

### Technical Improvements

1. **Caching Layer:** Redis for relevance scores and hot takes
2. **Message Queue:** RabbitMQ/SQS for async processing
3. **GraphQL API:** Flexible querying for web interface
4. **Real-Time Updates:** WebSocket for live approval interface
5. **Mobile App:** Native iOS/Android approval interface
6. **Browser Extension:** Quick approval from browser
7. **Webhook Support:** Trigger workflows from external events
8. **Plugin System:** Extensible architecture for custom components

## Conclusion

The Insight Engine provides a comprehensive solution for automated thought leadership content generation. The modular architecture allows for independent scaling and replacement of components, while the human-in-the-loop approval ensures quality control. The system balances automation with human oversight, enabling thought leaders to maintain an active presence across multiple platforms without sacrificing authenticity or quality.

The design emphasizes testability through property-based testing, ensuring that the system behaves correctly across all inputs. The dual testing approach (unit tests + property tests) provides comprehensive coverage while keeping tests maintainable and fast.

Deployment flexibility (serverless vs long-running) allows the system to adapt to different infrastructure requirements and cost constraints. The error handling strategy ensures resilience in the face of external API failures and transient issues.

Future enhancements will focus on multi-user support, analytics, and advanced content optimization, building on the solid foundation established in this initial design.
