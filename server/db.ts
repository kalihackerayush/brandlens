import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {
  PostRecord,
  PostStatus,
  PostActivity,
  MetricCounts,
  Role,
  Platform,
  AITaskRecord,
  AITaskStatus,
  AITaskType,
  PostDraft,
  ConnectedAccount,
  PublishingAttempt
} from '../src/types';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'brandlens.db');
const db = new DatabaseSync(dbPath);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    authorUsername TEXT NOT NULL,
    authorRole TEXT NOT NULL,
    platform TEXT NOT NULL,
    title TEXT NOT NULL,
    caption TEXT NOT NULL,
    status TEXT NOT NULL,
    isEnhanced INTEGER DEFAULT 0,
    postedAt TEXT,
    mediaRef TEXT,
    mediaType TEXT,
    mediaOriginalName TEXT,
    mediaSize INTEGER,
    textReviewResult TEXT,
    imageReviewResult TEXT,
    unresolvedIssuesCount INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS post_activities (
    id TEXT PRIMARY KEY,
    postId TEXT NOT NULL,
    actorUsername TEXT NOT NULL,
    eventType TEXT NOT NULL,
    description TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_tasks (
    id TEXT PRIMARY KEY,
    postId TEXT,
    authorUsername TEXT NOT NULL,
    authorRole TEXT NOT NULL,
    taskType TEXT NOT NULL,
    status TEXT NOT NULL,
    inputPayload TEXT NOT NULL,
    outputPayload TEXT,
    errorMessage TEXT,
    progressMessage TEXT,
    startedAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    completedAt TEXT
  );

  CREATE TABLE IF NOT EXISTS drafts (
    authorUsername TEXT PRIMARY KEY,
    authorRole TEXT NOT NULL,
    platform TEXT NOT NULL,
    title TEXT NOT NULL,
    caption TEXT NOT NULL,
    mediaRef TEXT,
    mediaType TEXT,
    mediaOriginalName TEXT,
    mediaSize INTEGER,
    textReviewResult TEXT,
    imageReviewResult TEXT,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS connected_accounts (
    id TEXT PRIMARY KEY,
    organizationId TEXT NOT NULL,
    platform TEXT NOT NULL,
    accountIdentifier TEXT NOT NULL,
    accountName TEXT NOT NULL,
    accountAvatar TEXT,
    accessTokenEnc TEXT NOT NULL,
    refreshTokenEnc TEXT,
    tokenExpiresAt TEXT,
    scopes TEXT NOT NULL,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS publishing_attempts (
    id TEXT PRIMARY KEY,
    postId TEXT NOT NULL,
    platform TEXT NOT NULL,
    accountId TEXT,
    attemptStatus TEXT NOT NULL,
    platformPostId TEXT,
    platformPostUrl TEXT,
    errorMessage TEXT,
    startedAt TEXT NOT NULL,
    completedAt TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(authorUsername);
  CREATE INDEX IF NOT EXISTS idx_activities_post ON post_activities(postId);
  CREATE INDEX IF NOT EXISTS idx_tasks_author ON ai_tasks(authorUsername);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON ai_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_accounts_org ON connected_accounts(organizationId);
  CREATE INDEX IF NOT EXISTS idx_pub_post ON publishing_attempts(postId);
`);

// Safe schema & data migration for unified post status lifecycle, isEnhanced, and organizationId
function migrateSchemaAndData() {
  try {
    const tableInfo = db.prepare('PRAGMA table_info(posts)').all() as Array<{ name: string }>;
    const colNames = new Set(tableInfo.map(c => c.name));

    if (!colNames.has('isEnhanced')) {
      db.exec('ALTER TABLE posts ADD COLUMN isEnhanced INTEGER DEFAULT 0;');
    }
    if (!colNames.has('postedAt')) {
      db.exec('ALTER TABLE posts ADD COLUMN postedAt TEXT;');
    }
    if (!colNames.has('organizationId')) {
      db.exec("ALTER TABLE posts ADD COLUMN organizationId TEXT DEFAULT 'org-nova-unlimited';");
    }

    // ai_tasks table migration
    const taskInfo = db.prepare('PRAGMA table_info(ai_tasks)').all() as Array<{ name: string }>;
    const taskCols = new Set(taskInfo.map(c => c.name));
    if (!taskCols.has('organizationId')) {
      db.exec("ALTER TABLE ai_tasks ADD COLUMN organizationId TEXT DEFAULT 'org-nova-unlimited';");
    }

    // drafts table migration
    const draftInfo = db.prepare('PRAGMA table_info(drafts)').all() as Array<{ name: string }>;
    const draftCols = new Set(draftInfo.map(c => c.name));
    if (!draftCols.has('organizationId')) {
      db.exec("ALTER TABLE drafts ADD COLUMN organizationId TEXT DEFAULT 'org-nova-unlimited';");
    }

    // Ensure all existing rows have organizationId populated
    db.prepare("UPDATE posts SET organizationId = 'org-nova-unlimited' WHERE organizationId IS NULL OR organizationId = ''").run();
    db.prepare("UPDATE ai_tasks SET organizationId = 'org-nova-unlimited' WHERE organizationId IS NULL OR organizationId = ''").run();
    db.prepare("UPDATE drafts SET organizationId = 'org-nova-unlimited' WHERE organizationId IS NULL OR organizationId = ''").run();

    // Migrate any legacy status values safely:
    // 'Published' or 'published' -> 'posted'
    db.prepare(`
      UPDATE posts
      SET status = 'posted',
          postedAt = COALESCE(postedAt, updatedAt)
      WHERE status IN ('Published', 'published')
    `).run();

    // 'Pending' with 0 unresolved issues and existing review -> 'ready_to_post'
    db.prepare(`
      UPDATE posts
      SET status = 'ready_to_post'
      WHERE status = 'Pending' AND unresolvedIssuesCount = 0 AND (textReviewResult IS NOT NULL OR mediaRef IS NOT NULL)
    `).run();

    // Remaining 'Pending' -> 'pending_review'
    db.prepare(`
      UPDATE posts
      SET status = 'pending_review'
      WHERE status = 'Pending'
    `).run();

    // Backfill isEnhanced for any post that had an applied suggestion or ai-generated image
    db.prepare(`
      UPDATE posts
      SET isEnhanced = 1
      WHERE isEnhanced = 0 AND (mediaOriginalName LIKE '%ai-generated%' OR (textReviewResult LIKE '%"isStale":true%' AND textReviewResult LIKE '%"suggested%'))
    `).run();
  } catch (err) {
    console.error('Migration error:', err);
  }
}
migrateSchemaAndData();

// Task recovery logic on server startup:
// Interrupted jobs that were queued or processing during restart are marked as INTERRUPTED
function recoverStaleTasks() {
  try {
    const stale = db.prepare(`SELECT id FROM ai_tasks WHERE status IN ('QUEUED', 'PROCESSING')`).all() as Array<{ id: string }>;
    const now = new Date().toISOString();
    for (const task of stale) {
      db.prepare(`
        UPDATE ai_tasks
        SET status = 'INTERRUPTED',
            progressMessage = 'Operation interrupted by server restart. Ready to resume.',
            updatedAt = ?
        WHERE id = ?
      `).run(now, task.id);
    }
    if (stale.length > 0) {
      console.log(`Recovered ${stale.length} interrupted AI task(s) on startup.`);
    }
  } catch (err) {
    console.error('Task recovery check error:', err);
  }
}
recoverStaleTasks();

// Seed initial role-specific demo data if empty
function seedIfEmpty() {
  const rowCount = db.prepare('SELECT COUNT(*) as cnt FROM posts').get() as { cnt: number };
  if (rowCount.cnt > 0) return;

  const now = new Date();
  const makeDate = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600000).toISOString();

  const starterPosts: Array<{
    id: string;
    authorUsername: string;
    authorRole: Role;
    platform: Platform;
    title: string;
    caption: string;
    status: PostStatus;
    isEnhanced: number;
    postedAt?: string | null;
    unresolvedIssuesCount: number;
    textReviewResult?: string;
    createdAt: string;
  }> = [
    {
      id: 'post-emp-1',
      authorUsername: 'employee',
      authorRole: 'Employee',
      platform: 'LinkedIn',
      title: 'BrandLens Precision Optics 2.0 Release',
      caption: 'Introducing our refined optical calibration engine. Experience 4x faster perceptual alignment across digital campaigns with zero artifact distortion.',
      status: 'ready_to_post',
      isEnhanced: 1,
      postedAt: null,
      unresolvedIssuesCount: 0,
      textReviewResult: JSON.stringify({
        verdict: 'looks_good',
        briefAnalysis: 'Technical specifications are clear, professional, and well-aligned with product guidelines.',
        suggestion: 'Consider specifying target integration partners in the follow-up thread.',
        suggestedTitle: null,
        suggestedCaption: null,
        issues: []
      }),
      createdAt: makeDate(5)
    },
    {
      id: 'post-emp-2',
      authorUsername: 'employee',
      authorRole: 'Employee',
      platform: 'Instagram',
      title: 'Behind the Glass: Engineering Light Flow',
      caption: 'Every curve in our refractive lens is crafted with sub-micron precision to guarantee crystal clarity in every digital impression.',
      status: 'pending_review',
      isEnhanced: 0,
      postedAt: null,
      unresolvedIssuesCount: 1,
      textReviewResult: JSON.stringify({
        verdict: 'changes_suggested',
        briefAnalysis: 'Strong visual narrative, but "sub-micron precision" should clarify hardware vs algorithmic lens calibration.',
        suggestion: 'Clarify that this refers to software-rendered optical processing.',
        suggestedTitle: null,
        suggestedCaption: 'Every curve in our algorithmic refractive lens is calculated with sub-micron fidelity to guarantee crystal clarity in every impression.',
        issues: ['Ambiguous hardware vs software calibration terminology']
      }),
      createdAt: makeDate(18)
    },
    {
      id: 'post-mgr-1',
      authorUsername: 'manager',
      authorRole: 'Manager',
      platform: 'LinkedIn',
      title: 'Q4 Brand Governance Milestone: 100% Policy Consistency',
      caption: 'Our team crossed 12,000 reviewed assets this quarter. Strategic alignment between marketing and product engineering has reduced compliance review cycles by 40%.',
      status: 'ready_to_post',
      isEnhanced: 1,
      postedAt: null,
      unresolvedIssuesCount: 0,
      textReviewResult: JSON.stringify({
        verdict: 'looks_good',
        briefAnalysis: 'Clear executive communication highlighting measurable team accomplishments.',
        suggestion: 'Highlight team member contributions in subsequent posts.',
        suggestedTitle: null,
        suggestedCaption: null,
        issues: []
      }),
      createdAt: makeDate(8)
    },
    {
      id: 'post-adm-1',
      authorUsername: 'admin',
      authorRole: 'Administrator',
      platform: 'X',
      title: 'BrandLens Global Enterprise Architecture Standard',
      caption: 'Announcing our updated corporate identity framework for multi-tenant brand governance. Unified clarity across all brand touchpoints.',
      status: 'posted',
      isEnhanced: 0,
      postedAt: makeDate(2),
      unresolvedIssuesCount: 0,
      textReviewResult: JSON.stringify({
        verdict: 'looks_good',
        briefAnalysis: 'Accurate organization-wide messaging adhering to core corporate tone.',
        suggestion: 'Add link to updated identity guidelines doc.',
        suggestedTitle: null,
        suggestedCaption: null,
        issues: []
      }),
      createdAt: makeDate(2)
    }
  ];

  const insertPost = db.prepare(`
    INSERT INTO posts (
      id, authorUsername, authorRole, platform, title, caption, status,
      isEnhanced, postedAt,
      mediaRef, mediaType, mediaOriginalName, mediaSize,
      textReviewResult, imageReviewResult, unresolvedIssuesCount, createdAt, updatedAt
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);

  const insertActivity = db.prepare(`
    INSERT INTO post_activities (id, postId, actorUsername, eventType, description, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const p of starterPosts) {
    insertPost.run(
      p.id,
      p.authorUsername,
      p.authorRole,
      p.platform,
      p.title,
      p.caption,
      p.status,
      p.isEnhanced,
      p.postedAt || null,
      null,
      null,
      null,
      null,
      p.textReviewResult || null,
      null,
      p.unresolvedIssuesCount,
      p.createdAt,
      p.createdAt
    );

    insertActivity.run(
      `act-${p.id}-created`,
      p.id,
      p.authorUsername,
      'created',
      `Post created and saved as ${p.status === 'ready_to_post' ? 'Ready to Post' : p.status === 'posted' ? 'Posted' : 'Pending for Review'}`,
      p.createdAt
    );

    if (p.textReviewResult) {
      insertActivity.run(
        `act-${p.id}-review`,
        p.id,
        p.authorUsername,
        'text_reviewed',
        'AI text review analysis completed',
        p.createdAt
      );
    }
  }
}

seedIfEmpty();

function parsePostRow(row: any): PostRecord {
  return {
    id: row.id,
    organizationId: row.organizationId || 'org-nova-unlimited',
    authorUsername: row.authorUsername,
    authorRole: row.authorRole,
    platform: row.platform,
    title: row.title,
    caption: row.caption,
    status: (row.status as PostStatus) || 'pending_review',
    isEnhanced: Boolean(row.isEnhanced),
    postedAt: row.postedAt || null,
    mediaRef: row.mediaRef,
    mediaType: row.mediaType,
    mediaOriginalName: row.mediaOriginalName,
    mediaSize: row.mediaSize,
    textReviewResult: row.textReviewResult ? JSON.parse(row.textReviewResult) : null,
    imageReviewResult: row.imageReviewResult ? JSON.parse(row.imageReviewResult) : null,
    unresolvedIssuesCount: Number(row.unresolvedIssuesCount) || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseTaskRow(row: any): AITaskRecord {
  return {
    id: row.id,
    postId: row.postId,
    authorUsername: row.authorUsername,
    authorRole: row.authorRole,
    taskType: row.taskType,
    status: row.status,
    inputPayload: row.inputPayload ? JSON.parse(row.inputPayload) : {},
    outputPayload: row.outputPayload ? JSON.parse(row.outputPayload) : null,
    errorMessage: row.errorMessage,
    progressMessage: row.progressMessage,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

export const dbService = {
  getPostsByAuthor(authorUsername: string): PostRecord[] {
    const rows = db.prepare('SELECT * FROM posts WHERE authorUsername = ? ORDER BY createdAt DESC').all(authorUsername);
    return rows.map(parsePostRow);
  },

  getPostById(id: string): PostRecord | null {
    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    return row ? parsePostRow(row) : null;
  },

  createPost(data: {
    id: string;
    organizationId?: string;
    authorUsername: string;
    authorRole: Role;
    platform: Platform;
    title: string;
    caption: string;
    status?: PostStatus;
    isEnhanced?: boolean;
    postedAt?: string | null;
    mediaRef?: string | null;
    mediaType?: 'image' | 'video' | 'pdf' | null;
    mediaOriginalName?: string | null;
    mediaSize?: number | null;
    textReviewResult?: any;
    imageReviewResult?: any;
    unresolvedIssuesCount: number;
  }): PostRecord {
    const now = new Date().toISOString();
    const status: PostStatus = data.status || 'pending_review';
    const isEnhanced = data.isEnhanced ? 1 : 0;
    const postedAt = data.postedAt || (status === 'posted' ? now : null);
    const orgId = data.organizationId || 'org-nova-unlimited';

    const insert = db.prepare(`
      INSERT INTO posts (
        id, organizationId, authorUsername, authorRole, platform, title, caption, status,
        isEnhanced, postedAt,
        mediaRef, mediaType, mediaOriginalName, mediaSize,
        textReviewResult, imageReviewResult, unresolvedIssuesCount, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      data.id,
      orgId,
      data.authorUsername,
      data.authorRole,
      data.platform,
      data.title,
      data.caption,
      status,
      isEnhanced,
      postedAt,
      data.mediaRef || null,
      data.mediaType || null,
      data.mediaOriginalName || null,
      data.mediaSize || null,
      data.textReviewResult ? JSON.stringify(data.textReviewResult) : null,
      data.imageReviewResult ? JSON.stringify(data.imageReviewResult) : null,
      data.unresolvedIssuesCount,
      now,
      now
    );

    this.createActivity(
      data.id,
      data.authorUsername,
      'created',
      `Post created and saved as ${status === 'ready_to_post' ? 'Ready to Post' : status === 'posted' ? 'Posted' : 'Pending for Review'}`
    );

    return this.getPostById(data.id)!;
  },

  updatePost(id: string, updates: Partial<PostRecord>, actorUsername: string): PostRecord | null {
    const existing = this.getPostById(id);
    if (!existing) return null;

    const now = new Date().toISOString();

    const newTitle = updates.title !== undefined ? updates.title : existing.title;
    const newCaption = updates.caption !== undefined ? updates.caption : existing.caption;
    const newPlatform = updates.platform !== undefined ? updates.platform : existing.platform;
    const newStatus = updates.status !== undefined ? updates.status : existing.status;
    const newIsEnhanced = updates.isEnhanced !== undefined ? (updates.isEnhanced ? 1 : 0) : (existing.isEnhanced ? 1 : 0);
    const newPostedAt = updates.postedAt !== undefined ? updates.postedAt : existing.postedAt;
    const newMediaRef = updates.mediaRef !== undefined ? updates.mediaRef : existing.mediaRef;
    const newMediaType = updates.mediaType !== undefined ? updates.mediaType : existing.mediaType;
    const newMediaOriginalName = updates.mediaOriginalName !== undefined ? updates.mediaOriginalName : existing.mediaOriginalName;
    const newMediaSize = updates.mediaSize !== undefined ? updates.mediaSize : existing.mediaSize;
    const newTextReview = updates.textReviewResult !== undefined ? updates.textReviewResult : existing.textReviewResult;
    const newImageReview = updates.imageReviewResult !== undefined ? updates.imageReviewResult : existing.imageReviewResult;
    const newIssuesCount = updates.unresolvedIssuesCount !== undefined ? updates.unresolvedIssuesCount : existing.unresolvedIssuesCount;

    db.prepare(`
      UPDATE posts SET
        title = ?,
        caption = ?,
        platform = ?,
        status = ?,
        isEnhanced = ?,
        postedAt = ?,
        mediaRef = ?,
        mediaType = ?,
        mediaOriginalName = ?,
        mediaSize = ?,
        textReviewResult = ?,
        imageReviewResult = ?,
        unresolvedIssuesCount = ?,
        updatedAt = ?
      WHERE id = ?
    `).run(
      newTitle,
      newCaption,
      newPlatform,
      newStatus,
      newIsEnhanced,
      newPostedAt || null,
      newMediaRef || null,
      newMediaType || null,
      newMediaOriginalName || null,
      newMediaSize || null,
      newTextReview ? JSON.stringify(newTextReview) : null,
      newImageReview ? JSON.stringify(newImageReview) : null,
      newIssuesCount,
      now,
      id
    );

    this.createActivity(id, actorUsername, 'updated', 'Post content or review status updated');

    return this.getPostById(id);
  },

  markPostReady(id: string, actorUsername: string): PostRecord | null {
    const existing = this.getPostById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE posts SET status = 'ready_to_post', updatedAt = ? WHERE id = ?
    `).run(now, id);
    this.createActivity(id, actorUsername, 'status_changed', 'Post status moved to Ready to Post');
    return this.getPostById(id);
  },

  markPostPosted(id: string, actorUsername: string): PostRecord | null {
    const existing = this.getPostById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE posts SET status = 'posted', postedAt = ?, updatedAt = ? WHERE id = ?
    `).run(now, now, id);
    this.createActivity(id, actorUsername, 'status_changed', 'Post confirmed and marked as Posted');
    return this.getPostById(id);
  },

  reopenPost(id: string, actorUsername: string, targetStatus: 'pending_review' | 'ready_to_post' = 'pending_review'): PostRecord | null {
    const existing = this.getPostById(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE posts SET status = ?, updatedAt = ? WHERE id = ?
    `).run(targetStatus, now, id);
    this.createActivity(
      id,
      actorUsername,
      'status_changed',
      `Post reopened for correction and moved to ${targetStatus === 'ready_to_post' ? 'Ready to Post' : 'Pending for Review'}`
    );
    return this.getPostById(id);
  },

  createActivity(postId: string, actorUsername: string, eventType: string, description: string): PostActivity {
    const now = new Date().toISOString();
    const id = `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    db.prepare(`
      INSERT INTO post_activities (id, postId, actorUsername, eventType, description, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, postId, actorUsername, eventType, description, now);

    return {
      id,
      postId,
      actorUsername,
      eventType: eventType as any,
      description,
      createdAt: now
    };
  },

  getActivitiesByPostId(postId: string): PostActivity[] {
    const rows = db.prepare('SELECT * FROM post_activities WHERE postId = ? ORDER BY createdAt ASC').all(postId);
    return rows.map((r: any) => ({
      id: r.id,
      postId: r.postId,
      actorUsername: r.actorUsername,
      eventType: r.eventType,
      description: r.description,
      createdAt: r.createdAt
    }));
  },

  getMetricsByAuthor(authorUsername: string): MetricCounts {
    const posts = this.getPostsByAuthor(authorUsername);
    const total = posts.length;
    const pending = posts.filter(p => p.status === 'pending_review' || p.status === 'ready_to_post').length;
    const enhanced = posts.filter(p => Boolean(p.isEnhanced)).length;
    const published = posts.filter(p => p.status === 'posted').length;

    return { total, pending, enhanced, published };
  },

  // --- AI Task Persistence & Recovery ---
  createAITask(data: {
    id: string;
    organizationId?: string;
    postId?: string | null;
    authorUsername: string;
    authorRole: Role;
    taskType: AITaskType;
    status: AITaskStatus;
    inputPayload: any;
    progressMessage?: string;
  }): AITaskRecord {
    const now = new Date().toISOString();
    const orgId = data.organizationId || 'org-nova-unlimited';
    db.prepare(`
      INSERT INTO ai_tasks (
        id, organizationId, postId, authorUsername, authorRole, taskType, status,
        inputPayload, outputPayload, errorMessage, progressMessage,
        startedAt, updatedAt, completedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      orgId,
      data.postId || null,
      data.authorUsername,
      data.authorRole,
      data.taskType,
      data.status,
      JSON.stringify(data.inputPayload),
      null,
      null,
      data.progressMessage || 'Task queued...',
      now,
      now,
      null
    );

    return this.getAITaskById(data.id)!;
  },

  updateAITask(id: string, updates: {
    status?: AITaskStatus;
    progressMessage?: string;
    outputPayload?: any;
    errorMessage?: string | null;
    completedAt?: string;
  }): AITaskRecord | null {
    const existing = this.getAITaskById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const newStatus = updates.status !== undefined ? updates.status : existing.status;
    const newProgress = (updates.progressMessage !== undefined ? updates.progressMessage : existing.progressMessage) || null;
    const newOutput = updates.outputPayload !== undefined ? JSON.stringify(updates.outputPayload) : (existing.outputPayload ? JSON.stringify(existing.outputPayload) : null);
    const newError = (updates.errorMessage !== undefined ? updates.errorMessage : existing.errorMessage) || null;
    const newCompleted = (updates.completedAt !== undefined ? updates.completedAt : existing.completedAt) || null;

    db.prepare(`
      UPDATE ai_tasks SET
        status = ?,
        progressMessage = ?,
        outputPayload = ?,
        errorMessage = ?,
        updatedAt = ?,
        completedAt = ?
      WHERE id = ?
    `).run(
      newStatus,
      newProgress,
      newOutput,
      newError,
      now,
      newCompleted,
      id
    );

    return this.getAITaskById(id);
  },

  getAITaskById(id: string): AITaskRecord | null {
    const row = db.prepare('SELECT * FROM ai_tasks WHERE id = ?').get(id);
    return row ? parseTaskRow(row) : null;
  },

  getAITasksByAuthor(authorUsername: string): AITaskRecord[] {
    const rows = db.prepare('SELECT * FROM ai_tasks WHERE authorUsername = ? ORDER BY startedAt DESC').all(authorUsername);
    return rows.map(parseTaskRow);
  },

  findActiveTask(authorUsername: string, taskType: AITaskType, title: string): AITaskRecord | null {
    const rows = db.prepare(`
      SELECT * FROM ai_tasks
      WHERE authorUsername = ? AND taskType = ? AND status IN ('QUEUED', 'PROCESSING')
      ORDER BY startedAt DESC
    `).all(authorUsername, taskType) as any[];

    for (const row of rows) {
      try {
        const payload = JSON.parse(row.inputPayload);
        if (payload.title === title) {
          return parseTaskRow(row);
        }
      } catch (e) {
        // ignore
      }
    }
    return null;
  },

  // --- Draft Autosave & Recovery ---
  saveDraft(draft: PostDraft & { organizationId?: string }): PostDraft {
    const now = new Date().toISOString();
    const orgId = draft.organizationId || 'org-nova-unlimited';
    db.prepare(`
      INSERT INTO drafts (
        authorUsername, organizationId, authorRole, platform, title, caption,
        mediaRef, mediaType, mediaOriginalName, mediaSize,
        textReviewResult, imageReviewResult, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(authorUsername) DO UPDATE SET
        organizationId = excluded.organizationId,
        authorRole = excluded.authorRole,
        platform = excluded.platform,
        title = excluded.title,
        caption = excluded.caption,
        mediaRef = excluded.mediaRef,
        mediaType = excluded.mediaType,
        mediaOriginalName = excluded.mediaOriginalName,
        mediaSize = excluded.mediaSize,
        textReviewResult = excluded.textReviewResult,
        imageReviewResult = excluded.imageReviewResult,
        updatedAt = excluded.updatedAt
    `).run(
      draft.authorUsername,
      orgId,
      draft.authorRole,
      draft.platform,
      draft.title,
      draft.caption,
      draft.mediaRef || null,
      draft.mediaType || null,
      draft.mediaOriginalName || null,
      draft.mediaSize || null,
      draft.textReviewResult ? JSON.stringify(draft.textReviewResult) : null,
      draft.imageReviewResult ? JSON.stringify(draft.imageReviewResult) : null,
      now
    );

    return this.getDraft(draft.authorUsername)!;
  },

  getDraft(authorUsername: string): PostDraft | null {
    const row = db.prepare('SELECT * FROM drafts WHERE authorUsername = ?').get(authorUsername) as any;
    if (!row) return null;
    return {
      authorUsername: row.authorUsername,
      authorRole: row.authorRole,
      platform: row.platform,
      title: row.title,
      caption: row.caption,
      mediaRef: row.mediaRef,
      mediaType: row.mediaType,
      mediaOriginalName: row.mediaOriginalName,
      mediaSize: row.mediaSize,
      textReviewResult: row.textReviewResult ? JSON.parse(row.textReviewResult) : null,
      imageReviewResult: row.imageReviewResult ? JSON.parse(row.imageReviewResult) : null,
      updatedAt: row.updatedAt,
    };
  },

  clearDraft(authorUsername: string): void {
    db.prepare('DELETE FROM drafts WHERE authorUsername = ?').run(authorUsername);
  },

  // --- Connected Accounts Operations ---
  getConnectedAccounts(organizationId: string = 'org-nova-unlimited'): ConnectedAccount[] {
    const rows = db.prepare('SELECT * FROM connected_accounts WHERE organizationId = ? ORDER BY platform ASC').all(organizationId) as any[];
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      platform: r.platform as Platform,
      accountIdentifier: r.accountIdentifier,
      accountName: r.accountName,
      accountAvatar: r.accountAvatar || null,
      scopes: r.scopes ? JSON.parse(r.scopes) : [],
      isActive: Boolean(r.isActive),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  },

  getConnectedAccountById(id: string): (ConnectedAccount & { accessTokenEnc: string; refreshTokenEnc?: string | null }) | null {
    const r = db.prepare('SELECT * FROM connected_accounts WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      organizationId: r.organizationId,
      platform: r.platform as Platform,
      accountIdentifier: r.accountIdentifier,
      accountName: r.accountName,
      accountAvatar: r.accountAvatar || null,
      scopes: r.scopes ? JSON.parse(r.scopes) : [],
      isActive: Boolean(r.isActive),
      accessTokenEnc: r.accessTokenEnc,
      refreshTokenEnc: r.refreshTokenEnc,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  },

  getConnectedAccountByPlatform(platform: Platform, organizationId: string = 'org-nova-unlimited'): (ConnectedAccount & { accessTokenEnc: string; refreshTokenEnc?: string | null }) | null {
    const r = db.prepare('SELECT * FROM connected_accounts WHERE platform = ? AND organizationId = ? AND isActive = 1 ORDER BY updatedAt DESC LIMIT 1').get(platform, organizationId) as any;
    if (!r) return null;
    return {
      id: r.id,
      organizationId: r.organizationId,
      platform: r.platform as Platform,
      accountIdentifier: r.accountIdentifier,
      accountName: r.accountName,
      accountAvatar: r.accountAvatar || null,
      scopes: r.scopes ? JSON.parse(r.scopes) : [],
      isActive: Boolean(r.isActive),
      accessTokenEnc: r.accessTokenEnc,
      refreshTokenEnc: r.refreshTokenEnc,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  },

  saveConnectedAccount(data: {
    id: string;
    organizationId?: string;
    platform: Platform;
    accountIdentifier: string;
    accountName: string;
    accountAvatar?: string | null;
    accessTokenEnc: string;
    refreshTokenEnc?: string | null;
    tokenExpiresAt?: string | null;
    scopes: string[];
    isActive?: boolean;
  }): ConnectedAccount {
    const now = new Date().toISOString();
    const orgId = data.organizationId || 'org-nova-unlimited';
    const isActive = data.isActive !== undefined ? (data.isActive ? 1 : 0) : 1;

    // Remove any previous account for this platform & org to keep clean single active link
    db.prepare('DELETE FROM connected_accounts WHERE platform = ? AND organizationId = ?').run(data.platform, orgId);

    db.prepare(`
      INSERT INTO connected_accounts (
        id, organizationId, platform, accountIdentifier, accountName, accountAvatar,
        accessTokenEnc, refreshTokenEnc, tokenExpiresAt, scopes, isActive, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      orgId,
      data.platform,
      data.accountIdentifier,
      data.accountName,
      data.accountAvatar || null,
      data.accessTokenEnc,
      data.refreshTokenEnc || null,
      data.tokenExpiresAt || null,
      JSON.stringify(data.scopes),
      isActive,
      now,
      now
    );

    return {
      id: data.id,
      organizationId: orgId,
      platform: data.platform,
      accountIdentifier: data.accountIdentifier,
      accountName: data.accountName,
      accountAvatar: data.accountAvatar || null,
      scopes: data.scopes,
      isActive: Boolean(isActive),
      createdAt: now,
      updatedAt: now,
    };
  },

  disconnectAccount(id: string): boolean {
    const result = db.prepare('DELETE FROM connected_accounts WHERE id = ?').run(id);
    return result.changes > 0;
  },

  toggleAccountActive(id: string, isActive: boolean): boolean {
    const now = new Date().toISOString();
    const result = db.prepare('UPDATE connected_accounts SET isActive = ?, updatedAt = ? WHERE id = ?').run(isActive ? 1 : 0, now, id);
    return result.changes > 0;
  },

  // --- Publishing Attempts Operations ---
  createPublishingAttempt(data: {
    id: string;
    postId: string;
    platform: Platform;
    accountId?: string | null;
  }): PublishingAttempt {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO publishing_attempts (
        id, postId, platform, accountId, attemptStatus, platformPostId, platformPostUrl, errorMessage, startedAt, completedAt
      ) VALUES (?, ?, ?, ?, 'pending', null, null, null, ?, null)
    `).run(
      data.id,
      data.postId,
      data.platform,
      data.accountId || null,
      now
    );

    return {
      id: data.id,
      postId: data.postId,
      platform: data.platform,
      accountId: data.accountId || null,
      attemptStatus: 'pending',
      platformPostId: null,
      platformPostUrl: null,
      errorMessage: null,
      startedAt: now,
      completedAt: null
    };
  },

  updatePublishingAttempt(id: string, updates: {
    attemptStatus: 'success' | 'failed';
    platformPostId?: string | null;
    platformPostUrl?: string | null;
    errorMessage?: string | null;
  }): PublishingAttempt | null {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE publishing_attempts SET
        attemptStatus = ?,
        platformPostId = ?,
        platformPostUrl = ?,
        errorMessage = ?,
        completedAt = ?
      WHERE id = ?
    `).run(
      updates.attemptStatus,
      updates.platformPostId || null,
      updates.platformPostUrl || null,
      updates.errorMessage || null,
      now,
      id
    );

    const row = db.prepare('SELECT * FROM publishing_attempts WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      postId: row.postId,
      platform: row.platform as Platform,
      accountId: row.accountId || null,
      attemptStatus: row.attemptStatus as any,
      platformPostId: row.platformPostId,
      platformPostUrl: row.platformPostUrl,
      errorMessage: row.errorMessage,
      startedAt: row.startedAt,
      completedAt: row.completedAt
    };
  },

  getPublishingAttemptsByPostId(postId: string): PublishingAttempt[] {
    const rows = db.prepare('SELECT * FROM publishing_attempts WHERE postId = ? ORDER BY startedAt DESC').all(postId) as any[];
    return rows.map((r) => ({
      id: r.id,
      postId: r.postId,
      platform: r.platform as Platform,
      accountId: r.accountId,
      attemptStatus: r.attemptStatus as any,
      platformPostId: r.platformPostId,
      platformPostUrl: r.platformPostUrl,
      errorMessage: r.errorMessage,
      startedAt: r.startedAt,
      completedAt: r.completedAt
    }));
  },

  getDatabaseStats() {
    let sizeBytes = 0;
    try {
      if (fs.existsSync(dbPath)) {
        sizeBytes = fs.statSync(dbPath).size;
      }
    } catch {}

    const postCount = (db.prepare('SELECT COUNT(*) as count FROM posts').get() as any)?.count || 0;
    const activityCount = (db.prepare('SELECT COUNT(*) as count FROM post_activities').get() as any)?.count || 0;
    const taskCount = (db.prepare('SELECT COUNT(*) as count FROM ai_tasks').get() as any)?.count || 0;
    const draftCount = (db.prepare('SELECT COUNT(*) as count FROM drafts').get() as any)?.count || 0;
    const accountCount = (db.prepare('SELECT COUNT(*) as count FROM connected_accounts').get() as any)?.count || 0;
    const publishCount = (db.prepare('SELECT COUNT(*) as count FROM publishing_attempts').get() as any)?.count || 0;

    return {
      engine: 'SQLite (Built-in Node.js DatabaseSync)',
      databasePath: dbPath,
      sizeBytes,
      sizeKb: (sizeBytes / 1024).toFixed(2),
      tables: {
        posts: postCount,
        post_activities: activityCount,
        ai_tasks: taskCount,
        drafts: draftCount,
        connected_accounts: accountCount,
        publishing_attempts: publishCount
      },
      ownership: '100% Self-Hosted & Owned Locally',
      lastExportAvailable: new Date().toISOString()
    };
  },

  exportFullDatabase() {
    const posts = db.prepare('SELECT * FROM posts').all();
    const activities = db.prepare('SELECT * FROM post_activities').all();
    const tasks = db.prepare('SELECT * FROM ai_tasks').all();
    const drafts = db.prepare('SELECT * FROM drafts').all();
    const accounts = db.prepare('SELECT * FROM connected_accounts').all();
    const publishing = db.prepare('SELECT * FROM publishing_attempts').all();

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      platform: 'BrandLens Data Sovereignty Export',
      databaseEngine: 'SQLite',
      data: {
        posts,
        activities,
        tasks,
        drafts,
        accounts,
        publishing
      }
    };
  },

  getRawDatabasePath() {
    return dbPath;
  }
};
