import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { dbService } from './db';
import { aiService, backgroundTaskManager } from './ai';
import { AITaskType, Role, Platform } from '../src/types';
import { getOrganizationConfig, getAllOrganizations } from './config/organizations';
import { getPlatformConfig, buildOAuthUrl, exchangeOAuthCode, publishPostDirect, getAppBaseUrl } from './social';

export const apiRouter = express.Router();

// --- Organization Routes ---
apiRouter.get('/organizations', (_req: Request, res: Response): void => {
  res.json({ success: true, organizations: getAllOrganizations() });
});

apiRouter.get('/organizations/:id', (req: Request, res: Response): void => {
  const org = getOrganizationConfig(req.params.id);
  res.json({ success: true, organization: org });
});

const maxUploadMb = parseInt(process.env.MAX_UPLOAD_MB || '25', 10);
const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage for uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = `upload-${Date.now()}-${Math.random().toString(36).substring(2, 7)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: maxUploadMb * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const allowedMime = [
      'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
      'video/mp4', 'video/quicktime', 'video/webm',
      'application/pdf'
    ];
    if (allowedMime.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not supported. Supported: images, videos, and PDFs.`));
    }
  }
});

const docUpload = multer({
  storage,
  limits: {
    fileSize: maxUploadMb * 1024 * 1024
  }
});

// --- Upload Route ---
apiRouter.post('/uploads', upload.single('media'), (req: Request, res: Response): void => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'No media file provided.' });
    return;
  }

  const mediaRef = `/uploads/${req.file.filename}`;
  let mediaType: 'image' | 'video' | 'pdf' = 'image';
  if (req.file.mimetype.startsWith('video/')) mediaType = 'video';
  else if (req.file.mimetype === 'application/pdf') mediaType = 'pdf';

  res.json({
    success: true,
    mediaRef,
    mediaType,
    mediaOriginalName: req.file.originalname,
    mediaSize: req.file.size
  });
});

// --- Persistent AI Tasks Routes (Non-blocking background jobs) ---
apiRouter.post('/tasks', (req: Request, res: Response): void => {
  const {
    taskType,
    postId,
    authorUsername,
    authorRole,
    platform,
    title,
    caption,
    mediaRef,
    organizationId
  } = req.body;

  if (!taskType || !authorUsername || !authorRole || !platform || !title) {
    res.status(400).json({ success: false, error: 'Missing required task fields.' });
    return;
  }

  // Idempotency: check if an identical task is already active (QUEUED or PROCESSING)
  const existingActive = dbService.findActiveTask(authorUsername, taskType as AITaskType, title);
  if (existingActive) {
    // Return existing task without spawning duplicate
    res.json({ success: true, task: existingActive, duplicatePrevented: true });
    return;
  }

  const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const task = dbService.createAITask({
    id: taskId,
    organizationId: organizationId || 'org-nova-unlimited',
    postId: postId || null,
    authorUsername,
    authorRole: authorRole as Role,
    taskType: taskType as AITaskType,
    status: 'QUEUED',
    inputPayload: {
      title,
      caption: caption || '',
      platform: platform as Platform,
      mediaRef: mediaRef || null
    },
    progressMessage: 'Task queued in background processor...'
  });

  // Start asynchronous background execution
  backgroundTaskManager.executeTask(task);

  res.status(202).json({ success: true, task });
});

apiRouter.get('/tasks', (req: Request, res: Response): void => {
  const authorUsername = (req.query.authorUsername as string) || '';
  if (!authorUsername) {
    res.status(400).json({ success: false, error: 'authorUsername query parameter is required.' });
    return;
  }

  const tasks = dbService.getAITasksByAuthor(authorUsername);
  res.json({ success: true, tasks });
});

apiRouter.get('/tasks/:id', (req: Request, res: Response): void => {
  const task = dbService.getAITaskById(req.params.id);
  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found.' });
    return;
  }
  res.json({ success: true, task });
});

apiRouter.post('/tasks/:id/retry', (req: Request, res: Response): void => {
  const task = dbService.getAITaskById(req.params.id);
  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found.' });
    return;
  }

  const updated = dbService.updateAITask(task.id, {
    status: 'QUEUED',
    errorMessage: null,
    progressMessage: 'Restarting task operation...'
  });

  if (updated) {
    backgroundTaskManager.executeTask(updated);
  }

  res.json({ success: true, task: updated });
});

// --- Autosave & Draft Routes ---
apiRouter.get('/drafts', (req: Request, res: Response): void => {
  const authorUsername = (req.query.authorUsername as string) || '';
  if (!authorUsername) {
    res.status(400).json({ success: false, error: 'authorUsername query parameter is required.' });
    return;
  }
  const draft = dbService.getDraft(authorUsername);
  res.json({ success: true, draft });
});

apiRouter.put('/drafts', (req: Request, res: Response): void => {
  const {
    authorUsername,
    authorRole,
    platform,
    title,
    caption,
    mediaRef,
    mediaType,
    mediaOriginalName,
    mediaSize,
    textReviewResult,
    imageReviewResult
  } = req.body;

  if (!authorUsername || !authorRole) {
    res.status(400).json({ success: false, error: 'authorUsername and authorRole are required.' });
    return;
  }

  const saved = dbService.saveDraft({
    authorUsername,
    authorRole,
    platform: platform || 'LinkedIn',
    title: title || '',
    caption: caption || '',
    mediaRef: mediaRef || null,
    mediaType: mediaType || null,
    mediaOriginalName: mediaOriginalName || null,
    mediaSize: mediaSize || null,
    textReviewResult: textReviewResult || null,
    imageReviewResult: imageReviewResult || null,
    updatedAt: new Date().toISOString()
  });

  res.json({ success: true, draft: saved });
});

apiRouter.delete('/drafts', (req: Request, res: Response): void => {
  const authorUsername = (req.query.authorUsername as string) || '';
  if (authorUsername) {
    dbService.clearDraft(authorUsername);
  }
  res.json({ success: true });
});

// --- Direct AI Routes (Synchronous fallback) ---
apiRouter.post('/ai/check-text', async (req: Request, res: Response): Promise<void> => {
  const { title, caption, platform, role, organizationId, orgId, simulate } = req.body;
  if (!title || !caption || !platform || !role) {
    res.status(400).json({ success: false, error: 'Missing required parameters: title, caption, platform, or role.' });
    return;
  }

  const result = await aiService.checkText({
    title,
    caption,
    platform,
    role,
    orgId: orgId || organizationId || 'org-nova-unlimited',
    simulate
  });
  res.json(result);
});

apiRouter.post('/ai/check-image', async (req: Request, res: Response): Promise<void> => {
  const { mediaRef, title, caption, platform, role, organizationId, orgId } = req.body;
  if (!mediaRef) {
    res.status(400).json({ success: false, error: 'Missing required mediaRef parameter for image analysis.' });
    return;
  }

  const result = await aiService.checkImage({
    mediaRef,
    title: title || 'BrandLens Visual Asset',
    caption: caption || 'Visual inspection for public posting',
    platform: (platform as Platform) || 'LinkedIn',
    role: (role as Role) || 'Employee',
    orgId: orgId || organizationId || 'org-nova-unlimited'
  });
  res.json(result);
});

apiRouter.post('/ai/generate-image', async (req: Request, res: Response): Promise<void> => {
  const { prompt, title, caption, platform, role, organizationId, orgId } = req.body;
  if (!prompt && (!title || !caption)) {
    res.status(400).json({ success: false, error: 'Either prompt or title and caption are required for image generation.' });
    return;
  }

  const result = await aiService.generateImage({
    prompt,
    title: title || 'Enterprise Cloud Infrastructure',
    caption: caption || 'High performance server infrastructure',
    platform: (platform as Platform) || 'LinkedIn',
    role: (role as Role) || 'Employee',
    orgId: orgId || organizationId || 'org-nova-unlimited'
  });
  res.json(result);
});

// --- Text Enhancer Route ---
apiRouter.post('/ai/enhance-text', async (req: Request, res: Response): Promise<void> => {
  const { text, role, platform, tone, organizationId, orgId } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ success: false, error: 'Text content is required for enhancement.' });
    return;
  }

  const result = await aiService.enhanceText({
    text: text.trim(),
    role: (role as Role) || 'Employee',
    platform: (platform as Platform) || 'LinkedIn',
    tone: tone || 'Authoritative, clear, and professional',
    orgId: orgId || organizationId || 'org-nova-unlimited'
  });
  res.json(result);
});

// --- Document Review & Text Extraction Route ---
apiRouter.post('/ai/extract-document', docUpload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No document file was uploaded.' });
      return;
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const buffer = fs.readFileSync(filePath);
    let extractedText = '';

    if (ext === '.pdf') {
      try {
        const pdfModule: any = await import('pdf-parse');
        const pdfFn = pdfModule.default || pdfModule;
        if (typeof pdfFn === 'function') {
          const pdfData = await pdfFn(buffer);
          extractedText = pdfData?.text || '';
        } else if (pdfModule.PDFParse) {
          const parser: any = new pdfModule.PDFParse(buffer);
          if (typeof parser.load === 'function') await parser.load();
          const pdfData = typeof parser.getText === 'function' ? await parser.getText() : null;
          extractedText = pdfData?.text || '';
        }
      } catch (pdfErr) {
        // Stream text fallback
        extractedText = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
      }
    } else if (ext === '.docx' || ext === '.doc') {
      try {
        // @ts-ignore
        const mammothModule = await import('mammoth');
        const mammoth = mammothModule.default || mammothModule;
        const docxResult = await mammoth.extractRawText({ buffer });
        extractedText = docxResult?.value || '';
      } catch (docErr) {
        extractedText = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
      }
    } else {
      // Plain text, markdown, json, etc.
      extractedText = buffer.toString('utf-8');
    }

    const cleanText = (extractedText || '').trim();
    const words = cleanText ? cleanText.split(/\s+/).filter(Boolean).length : 0;
    const chars = cleanText.length;

    res.json({
      success: true,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType: ext.replace('.', '').toUpperCase() || 'DOCUMENT',
      text: cleanText || 'No readable text content could be extracted from this document.',
      wordCount: words,
      charCount: chars
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to extract text from document.' });
  }
});

// --- Posts CRUD Routes ---
apiRouter.get('/posts', (req: Request, res: Response): void => {
  const authorUsername = (req.query.authorUsername as string) || '';
  if (!authorUsername) {
    res.status(400).json({ success: false, error: 'authorUsername query parameter is required.' });
    return;
  }

  const posts = dbService.getPostsByAuthor(authorUsername);
  res.json({ success: true, posts });
});

apiRouter.post('/posts', (req: Request, res: Response): void => {
  const {
    authorUsername,
    authorRole,
    platform,
    title,
    caption,
    mediaRef,
    mediaType,
    mediaOriginalName,
    mediaSize,
    textReviewResult,
    imageReviewResult,
    unresolvedIssuesCount,
    status,
    isEnhanced,
    organizationId
  } = req.body;

  if (!authorUsername || !authorRole || !platform || !title || !caption) {
    res.status(400).json({ success: false, error: 'Missing required post fields: title, caption, platform, and author.' });
    return;
  }

  const id = `post-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const post = dbService.createPost({
    id,
    organizationId: organizationId || 'org-nova-unlimited',
    authorUsername,
    authorRole,
    platform,
    title,
    caption,
    status: status || 'pending_review',
    isEnhanced: Boolean(isEnhanced),
    mediaRef: mediaRef || null,
    mediaType: mediaType || null,
    mediaOriginalName: mediaOriginalName || null,
    mediaSize: mediaSize || null,
    textReviewResult: textReviewResult || null,
    imageReviewResult: imageReviewResult || null,
    unresolvedIssuesCount: Number(unresolvedIssuesCount) || 0
  });

  // Clear autosaved draft on successful post creation
  dbService.clearDraft(authorUsername);

  res.status(201).json({ success: true, post });
});

apiRouter.get('/posts/:id', (req: Request, res: Response): void => {
  const post = dbService.getPostById(req.params.id);
  if (!post) {
    res.status(404).json({ success: false, error: 'Post not found.' });
    return;
  }
  res.json({ success: true, post });
});

apiRouter.put('/posts/:id', (req: Request, res: Response): void => {
  const actorUsername = req.body.actorUsername || 'system';
  const updated = dbService.updatePost(req.params.id, req.body, actorUsername);
  if (!updated) {
    res.status(404).json({ success: false, error: 'Post not found.' });
    return;
  }
  res.json({ success: true, post: updated });
});

// Dedicated Status Lifecycle Transitions
apiRouter.post('/posts/:id/mark-ready', (req: Request, res: Response): void => {
  const actorUsername = req.body.actorUsername || 'system';
  const updated = dbService.markPostReady(req.params.id, actorUsername);
  if (!updated) {
    res.status(404).json({ success: false, error: 'Post not found.' });
    return;
  }
  res.json({ success: true, post: updated });
});

apiRouter.post('/posts/:id/mark-posted', (req: Request, res: Response): void => {
  const actorUsername = req.body.actorUsername || 'system';
  const updated = dbService.markPostPosted(req.params.id, actorUsername);
  if (!updated) {
    res.status(404).json({ success: false, error: 'Post not found.' });
    return;
  }
  res.json({ success: true, post: updated });
});

apiRouter.post('/posts/:id/reopen', (req: Request, res: Response): void => {
  const actorUsername = req.body.actorUsername || 'system';
  const targetStatus = req.body.targetStatus || 'pending_review';
  const updated = dbService.reopenPost(req.params.id, actorUsername, targetStatus);
  if (!updated) {
    res.status(404).json({ success: false, error: 'Post not found.' });
    return;
  }
  res.json({ success: true, post: updated });
});

apiRouter.get('/posts/:id/activity', (req: Request, res: Response): void => {
  const activities = dbService.getActivitiesByPostId(req.params.id);
  res.json({ success: true, activities });
});

apiRouter.get('/metrics', (req: Request, res: Response): void => {
  const authorUsername = (req.query.authorUsername as string) || '';
  if (!authorUsername) {
    res.status(400).json({ success: false, error: 'authorUsername query parameter is required.' });
    return;
  }
  const metrics = dbService.getMetricsByAuthor(authorUsername);
  res.json({ success: true, metrics });
});

// --- Connected Accounts & OAuth Routes ---
apiRouter.get('/connected-accounts', (req: Request, res: Response): void => {
  const orgId = (req.query.orgId as string) || 'org-nova-unlimited';
  const accounts = dbService.getConnectedAccounts(orgId);

  // Augment with isConfigured check
  const augmented = accounts.map((acc) => {
    const cfg = getPlatformConfig(acc.platform, req);
    return {
      ...acc,
      isConfigured: cfg.isConfigured
    };
  });

  res.json({ success: true, accounts: augmented });
});

apiRouter.get('/connected-accounts/configs', (req: Request, res: Response): void => {
  const platforms: Platform[] = ['LinkedIn', 'Instagram', 'X'];
  const configs = platforms.map((p) => getPlatformConfig(p, req));
  res.json({ success: true, configs });
});

apiRouter.get('/auth/url/:platform', (req: Request, res: Response): void => {
  const rawPlat = req.params.platform.toLowerCase();
  let plat: Platform | null = null;
  if (rawPlat === 'linkedin') plat = 'LinkedIn';
  else if (rawPlat === 'instagram') plat = 'Instagram';
  else if (rawPlat === 'x' || rawPlat === 'twitter') plat = 'X';

  if (!plat) {
    res.status(400).json({ success: false, error: 'Invalid platform.' });
    return;
  }

  const result = buildOAuthUrl(plat, req);
  if (result.error) {
    res.status(400).json({ success: false, error: result.error });
    return;
  }

  res.json({ success: true, url: result.url });
});

// OAuth Callback (lightweight HTML snippet that postMessages to opener and closes)
apiRouter.get(['/auth/callback/:platform', '/auth/callback/:platform/'], async (req: Request, res: Response): Promise<void> => {
  const rawPlat = req.params.platform.toLowerCase();
  let plat: Platform | null = null;
  if (rawPlat === 'linkedin') plat = 'LinkedIn';
  else if (rawPlat === 'instagram') plat = 'Instagram';
  else if (rawPlat === 'x' || rawPlat === 'twitter') plat = 'X';

  const code = (req.query.code as string) || '';
  const error = (req.query.error_description || req.query.error as string) || '';

  if (error || !code || !plat) {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Connection Failed</title></head>
        <body style="font-family: sans-serif; background: #0c0d14; color: #ffb6bd; padding: 2rem; text-align: center;">
          <h2>Connection Unsuccessful</h2>
          <p>${error || 'Missing authorization code from provider.'}</p>
          <script>
            setTimeout(() => { if (window.opener) window.close(); }, 3000);
          </script>
        </body>
      </html>
    `);
    return;
  }

  const exchangeResult = await exchangeOAuthCode(plat, code, req);

  if (exchangeResult.success) {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Account Connected</title></head>
        <body style="font-family: sans-serif; background: #0c0d14; color: #a4e6cf; padding: 2rem; text-align: center;">
          <h2 style="color: #fff;">${plat} Account Connected!</h2>
          <p style="color: #a4e6cf;">Closing window and updating BrandLens workspace...</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', platform: '${plat}' }, '*');
              setTimeout(() => window.close(), 600);
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Connection Failed</title></head>
        <body style="font-family: sans-serif; background: #0c0d14; color: #ffb6bd; padding: 2rem; text-align: center;">
          <h2>Connection Failed</h2>
          <p>${exchangeResult.error || 'Token exchange failed.'}</p>
          <button onclick="window.close()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #333; color: white; border: none; border-radius: 4px; cursor: pointer;">Close Window</button>
        </body>
      </html>
    `);
  }
});

apiRouter.delete('/connected-accounts/:id', (req: Request, res: Response): void => {
  const success = dbService.disconnectAccount(req.params.id);
  res.json({ success });
});

apiRouter.post('/connected-accounts/:id/toggle', (req: Request, res: Response): void => {
  const { isActive } = req.body;
  const success = dbService.toggleAccountActive(req.params.id, Boolean(isActive));
  res.json({ success });
});

// --- Direct Publishing API ---
apiRouter.post('/publish', async (req: Request, res: Response): Promise<void> => {
  const { postId, actorUsername, organizationId } = req.body;
  if (!postId || !actorUsername) {
    res.status(400).json({ success: false, error: 'postId and actorUsername are required.' });
    return;
  }

  const result = await publishPostDirect({
    postId,
    actorUsername,
    organizationId: organizationId || 'org-nova-unlimited',
    req
  });

  if (!result.success) {
    res.status(400).json({ success: false, error: result.errorMessage });
    return;
  }

  const updatedPost = dbService.getPostById(postId);
  res.json({
    success: true,
    post: updatedPost,
    platformPostId: result.platformPostId,
    publishedUrl: result.publishedUrl
  });
});

apiRouter.get('/publishing/attempts/:postId', (req: Request, res: Response): void => {
  const attempts = dbService.getPublishingAttemptsByPostId(req.params.postId);
  res.json({ success: true, attempts });
});

// --- Help & Support Routes ---
apiRouter.get('/config/support', (_req: Request, res: Response): void => {
  const rawNumber = (process.env.WHATSAPP_SUPPORT_NUMBER || '').trim();
  const digitsOnly = rawNumber.replace(/\D/g, '');
  res.json({
    success: true,
    whatsappConfigured: Boolean(digitsOnly),
    whatsappSupportNumber: digitsOnly
  });
});

apiRouter.post('/help/chat', async (req: Request, res: Response): Promise<void> => {
  const { message, history } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ success: false, error: 'A user question is required.' });
    return;
  }

  const result = await aiService.answerHelpQuestion({
    message: message.trim(),
    history: Array.isArray(history) ? history : []
  });

  res.json(result);
});

// --- Data Ownership & Database Management Routes ---
apiRouter.get('/database/stats', (_req: Request, res: Response): void => {
  try {
    const stats = dbService.getDatabaseStats();
    res.json({ success: true, stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to retrieve database statistics.' });
  }
});

apiRouter.get('/database/export', (_req: Request, res: Response): void => {
  try {
    const exportData = dbService.exportFullDatabase();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="brandlens-export-${Date.now()}.json"`);
    res.send(JSON.stringify(exportData, null, 2));
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to export database.' });
  }
});

apiRouter.get('/database/backup', (_req: Request, res: Response): void => {
  try {
    const dbFile = dbService.getRawDatabasePath();
    if (!fs.existsSync(dbFile)) {
      res.status(404).json({ success: false, error: 'Database file not found on server.' });
      return;
    }
    res.download(dbFile, `brandlens-backup-${Date.now()}.db`);
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to download database backup.' });
  }
});


