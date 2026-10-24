import {
  PostRecord,
  PostStatus,
  PostActivity,
  MetricCounts,
  Platform,
  Role,
  TextReviewResult,
  ImageReviewResult,
  AITaskRecord,
  AITaskType,
  PostDraft,
  ConnectedAccount,
  PlatformConfigStatus,
  PublishingAttempt
} from '../types';

export const apiClient = {
  // Posts CRUD
  async fetchPosts(authorUsername: string): Promise<PostRecord[]> {
    const res = await fetch(`/api/posts?authorUsername=${encodeURIComponent(authorUsername)}`);
    if (!res.ok) throw new Error('Failed to load posts');
    const data = await res.json();
    return data.posts || [];
  },

  async fetchPost(id: string): Promise<PostRecord> {
    const res = await fetch(`/api/posts/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Post not found');
    const data = await res.json();
    return data.post;
  },

  async createPost(post: {
    organizationId?: string;
    authorUsername: string;
    authorRole: Role;
    platform: Platform;
    title: string;
    caption: string;
    status?: PostStatus;
    isEnhanced?: boolean;
    mediaRef?: string | null;
    mediaType?: 'image' | 'video' | 'pdf' | null;
    mediaOriginalName?: string | null;
    mediaSize?: number | null;
    textReviewResult?: TextReviewResult | null;
    imageReviewResult?: ImageReviewResult | null;
    unresolvedIssuesCount: number;
  }): Promise<PostRecord> {
    const res = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: post.organizationId || 'org-nova-unlimited', ...post })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create post' }));
      throw new Error(err.error || 'Failed to create post');
    }
    const data = await res.json();
    return data.post;
  },

  async updatePost(id: string, updates: Partial<PostRecord>, actorUsername: string): Promise<PostRecord> {
    const res = await fetch(`/api/posts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, actorUsername })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update post' }));
      throw new Error(err.error || 'Failed to update post');
    }
    const data = await res.json();
    return data.post;
  },

  async markAsReady(id: string, actorUsername: string): Promise<PostRecord> {
    const res = await fetch(`/api/posts/${encodeURIComponent(id)}/mark-ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorUsername })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to mark post as ready' }));
      throw new Error(err.error || 'Failed to mark post as ready');
    }
    const data = await res.json();
    return data.post;
  },

  async markAsPosted(id: string, actorUsername: string): Promise<PostRecord> {
    const res = await fetch(`/api/posts/${encodeURIComponent(id)}/mark-posted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorUsername })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to mark post as posted' }));
      throw new Error(err.error || 'Failed to mark post as posted');
    }
    const data = await res.json();
    return data.post;
  },

  async reopenPost(id: string, actorUsername: string, targetStatus?: 'pending_review' | 'ready_to_post'): Promise<PostRecord> {
    const res = await fetch(`/api/posts/${encodeURIComponent(id)}/reopen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorUsername, targetStatus: targetStatus || 'pending_review' })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to reopen post' }));
      throw new Error(err.error || 'Failed to reopen post');
    }
    const data = await res.json();
    return data.post;
  },

  async fetchActivities(postId: string): Promise<PostActivity[]> {
    const res = await fetch(`/api/posts/${encodeURIComponent(postId)}/activity`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.activities || [];
  },

  async fetchMetrics(authorUsername: string): Promise<MetricCounts> {
    const res = await fetch(`/api/metrics?authorUsername=${encodeURIComponent(authorUsername)}`);
    if (!res.ok) {
      return { total: 0, pending: 0, enhanced: 0, published: 0 };
    }
    const data = await res.json();
    return data.metrics;
  },

  async uploadMedia(file: File): Promise<{
    mediaRef: string;
    mediaType: 'image' | 'video' | 'pdf';
    mediaOriginalName: string;
    mediaSize: number;
  }> {
    const formData = new FormData();
    formData.append('media', file);

    const res = await fetch('/api/uploads', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Media upload failed' }));
      throw new Error(err.error || 'Media upload failed');
    }

    const data = await res.json();
    return data;
  },

  // Organization APIs
  async fetchOrganizations(): Promise<any[]> {
    const res = await fetch('/api/organizations');
    if (!res.ok) return [];
    const data = await res.json();
    return data.organizations || [];
  },

  async fetchOrganization(id = 'org-nova-unlimited'): Promise<any> {
    const res = await fetch(`/api/organizations/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.organization || null;
  },

  // Persistent Background AI Tasks
  async startTask(params: {
    taskType: AITaskType;
    postId?: string | null;
    authorUsername: string;
    authorRole: Role;
    platform: Platform;
    title: string;
    caption: string;
    mediaRef?: string | null;
    organizationId?: string;
  }): Promise<{ success: boolean; task: AITaskRecord; duplicatePrevented?: boolean }> {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: 'org-nova-unlimited', ...params })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to initialize AI task');
    return data;
  },

  async fetchTasks(authorUsername: string): Promise<AITaskRecord[]> {
    const res = await fetch(`/api/tasks?authorUsername=${encodeURIComponent(authorUsername)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.tasks || [];
  },

  async fetchTask(id: string): Promise<AITaskRecord> {
    const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Task not found');
    const data = await res.json();
    return data.task;
  },

  async retryTask(id: string): Promise<AITaskRecord> {
    const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/retry`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Failed to restart task');
    const data = await res.json();
    return data.task;
  },

  // Drafts & Autosave
  async fetchDraft(authorUsername: string): Promise<PostDraft | null> {
    const res = await fetch(`/api/drafts?authorUsername=${encodeURIComponent(authorUsername)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.draft || null;
  },

  async saveDraft(draft: PostDraft & { organizationId?: string }): Promise<PostDraft> {
    const res = await fetch('/api/drafts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: 'org-nova-unlimited', ...draft })
    });
    if (!res.ok) throw new Error('Draft autosave failed');
    const data = await res.json();
    return data.draft;
  },

  async clearDraft(authorUsername: string): Promise<void> {
    await fetch(`/api/drafts?authorUsername=${encodeURIComponent(authorUsername)}`, {
      method: 'DELETE'
    });
  },

  // Direct sync endpoints (preserved)
  async checkText(params: {
    title: string;
    caption: string;
    platform: Platform;
    role: Role;
    simulate?: 'malformed_response' | 'api_failure' | 'timeout';
  }): Promise<{ success: boolean; data?: TextReviewResult; error?: string }> {
    const res = await fetch('/api/ai/check-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return res.json();
  },

  async checkImage(params: {
    mediaRef: string;
    title?: string;
    caption?: string;
    platform?: Platform;
    role?: Role;
    orgId?: string;
  }): Promise<{ success: boolean; data?: ImageReviewResult; error?: string }> {
    const res = await fetch('/api/ai/check-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return res.json();
  },

  async generateImage(params: {
    prompt?: string;
    title?: string;
    caption?: string;
    platform?: Platform;
    role?: Role;
    orgId?: string;
  }): Promise<{ success: boolean; prompt?: string; generatedPrompt?: string; mediaRef?: string; error?: string }> {
    const res = await fetch('/api/ai/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return res.json();
  },

  async enhanceText(params: {
    text: string;
    role?: Role;
    platform?: Platform;
    tone?: string;
    orgId?: string;
  }): Promise<{
    success: boolean;
    originalText?: string;
    enhancedText?: string;
    briefExplanation?: string;
    keyImprovements?: string[];
    wordCount?: number;
    charCount?: number;
    error?: string;
  }> {
    const res = await fetch('/api/ai/enhance-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return res.json();
  },

  async extractDocument(file: File): Promise<{
    success: boolean;
    fileName?: string;
    fileSize?: number;
    fileType?: string;
    text?: string;
    wordCount?: number;
    charCount?: number;
    error?: string;
  }> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/ai/extract-document', {
      method: 'POST',
      body: formData
    });
    return res.json();
  },

  // --- Connected Accounts & Direct Publishing ---
  async fetchConnectedAccounts(orgId?: string): Promise<ConnectedAccount[]> {
    const res = await fetch(`/api/connected-accounts${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.accounts || [];
  },

  async fetchPlatformConfigs(): Promise<PlatformConfigStatus[]> {
    const res = await fetch('/api/connected-accounts/configs');
    if (!res.ok) return [];
    const data = await res.json();
    return data.configs || [];
  },

  async getAuthUrl(platform: Platform, mode?: string): Promise<string> {
    const query = mode ? `?mode=${encodeURIComponent(mode)}` : '';
    const res = await fetch(`/api/auth/url/${encodeURIComponent(platform.toLowerCase())}${query}`);
    const data = await res.json();
    if (!res.ok || !data.url) {
      throw new Error(data.error || `Failed to generate auth URL for ${platform}`);
    }
    return data.url;
  },

  async disconnectAccount(id: string): Promise<boolean> {
    const res = await fetch(`/api/connected-accounts/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    return res.ok;
  },

  async toggleAccount(id: string, isActive: boolean): Promise<boolean> {
    const res = await fetch(`/api/connected-accounts/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive })
    });
    return res.ok;
  },

  async publishPost(postId: string, actorUsername: string): Promise<{ success: boolean; post?: PostRecord; error?: string; publishedUrl?: string }> {
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, actorUsername })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Direct publishing failed');
    }
    return data;
  },

  async fetchPublishingAttempts(postId: string): Promise<PublishingAttempt[]> {
    const res = await fetch(`/api/publishing/attempts/${encodeURIComponent(postId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.attempts || [];
  },

  // --- Help Assistant & Support Config ---
  async fetchSupportConfig(): Promise<{ whatsappConfigured: boolean; whatsappSupportNumber: string }> {
    try {
      const res = await fetch('/api/config/support');
      if (!res.ok) return { whatsappConfigured: false, whatsappSupportNumber: '' };
      const data = await res.json();
      return {
        whatsappConfigured: Boolean(data.whatsappConfigured),
        whatsappSupportNumber: data.whatsappSupportNumber || ''
      };
    } catch {
      return { whatsappConfigured: false, whatsappSupportNumber: '' };
    }
  },

  async askHelpQuestion(params: {
    message: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<{ success: boolean; answer: string; error?: string }> {
    const res = await fetch('/api/help/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'The help assistant is temporarily unavailable. Please try again.');
    }
    return data;
  },

  // --- Database Ownership & Backup ---
  async fetchDatabaseStats(): Promise<{
    success: boolean;
    stats?: {
      engine: string;
      databasePath: string;
      sizeBytes: number;
      sizeKb: string;
      tables: Record<string, number>;
      ownership: string;
      lastExportAvailable: string;
    };
    error?: string;
  }> {
    try {
      const res = await fetch('/api/database/stats');
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  getDatabaseExportUrl(): string {
    return '/api/database/export';
  },

  getDatabaseBackupUrl(): string {
    return '/api/database/backup';
  }
};

