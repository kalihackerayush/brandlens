import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Role, PostRecord, MetricCounts } from './types';
import { apiClient } from './services/api';
import { Sidebar, NavTab } from './components/dashboard/Sidebar';
import { Header } from './components/dashboard/Header';
import { DashboardView } from './components/dashboard/DashboardView';
import { NewPost } from './components/new-post/NewPost';
import { PendingView } from './components/pending/PendingView';
import { HistoryView } from './components/history/HistoryView';
import { ConnectedAccountsView } from './components/accounts/ConnectedAccountsView';
import { HelpView } from './components/help/HelpView';
import { AboutView } from './components/about/AboutView';
import { LandingPage } from './components/landing/LandingPage';
import { FloatingAssistant } from './components/common/FloatingAssistant';
import { EnhancerView } from './components/enhancer/EnhancerView';
import { DataSecurityView } from './components/security/DataSecurityView';

interface Account {
  password: string;
  role: Role;
}

// Exactly 3 demo accounts (CEO removed as requested)
const ACCOUNTS: Record<string, Account> = {
  employee: { password: 'employee123', role: 'Employee' },
  manager: { password: 'manager123', role: 'Manager' },
  admin: { password: 'admin123', role: 'Administrator' },
};

const THOUGHTS = [
  <>Every detail has a <em>meaning.</em></>,
  <>Every word leaves a <em>mark.</em></>,
  <>Every brand has a <em>standard.</em></>,
  <>Precision is not an <em>accident.</em></>,
  <>Make every impression <em>count.</em></>,
];

const HERO_PHRASES = [
  "Without the noise.",
  "With crystalline focus.",
  "Without distortion.",
  "In absolute clarity.",
  "True to your identity.",
];

interface WaterRipple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  speed: number;
  color: string;
}

export default function App() {
  // Cinematic intro state
  const [introDone, setIntroDone] = useState(false);
  const [thoughtsActive, setThoughtsActive] = useState(false);
  const [activeThoughtIndex, setActiveThoughtIndex] = useState<number | null>(null);
  const [siteVisible, setSiteVisible] = useState(false);

  // Header dynamic phrase changing state
  const [phraseIndex, setPhraseIndex] = useState(0);

  // Views state
  const [loginActive, setLoginActive] = useState(false);
  const [dashboardActive, setDashboardActive] = useState(false);
  const [guestAboutOpen, setGuestAboutOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Authenticated user state
  const [currentUser, setCurrentUser] = useState<{ username: string; role: Role } | null>(null);
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [metrics, setMetrics] = useState<MetricCounts>({ total: 0, pending: 0, enhanced: 0, published: 0 });
  const [loadingData, setLoadingData] = useState(false);

  // Form state (pre-filled with employee credentials by default)
  const [username, setUsername] = useState('employee');
  const [password, setPassword] = useState('employee123');
  const [role, setRole] = useState<Role>('Employee');
  const [showPassword, setShowPassword] = useState(false);
  const [formMessage, setFormMessage] = useState<{ text: string; isSuccess: boolean }>({ text: '', isSuccess: false });
  const [demoOpen, setDemoOpen] = useState(false);

  // Custom cursor state
  const [cursorPos, setCursorPos] = useState({ x: -100, y: -100 });
  const [cursorHovering, setCursorHovering] = useState(false);
  const [cursorClicking, setCursorClicking] = useState(false);
  const [isFinePointer, setIsFinePointer] = useState(false);

  // Success toast message
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Refs
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ripplesRef = useRef<WaterRipple[]>([]);
  const timersRef = useRef<number[]>([]);
  const introFinishedRef = useRef(false);

  // Smooth lagging ring position for cursor
  const ringPosRef = useRef({ x: -100, y: -100 });
  const ringTargetRef = useRef({ x: -100, y: -100 });
  const ringElRef = useRef<HTMLDivElement>(null);

  const clearThoughtTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    setActiveThoughtIndex(null);
  }, []);

  const showLanding = useCallback(() => {
    clearThoughtTimers();
    setIntroDone(true);
    setThoughtsActive(false);
    setSiteVisible(true);
    introFinishedRef.current = true;
  }, [clearThoughtTimers]);

  // Check for restored session on mount
  useEffect(() => {
    try {
      const savedSession = sessionStorage.getItem('brandlens_session');
      if (savedSession) {
        const parsed = JSON.parse(savedSession);
        if (parsed.username && parsed.role) {
          setCurrentUser(parsed);
          setDashboardActive(true);
          setIntroDone(true);
          setSiteVisible(false);
          introFinishedRef.current = true;
          loadUserData(parsed.username);
        }
      }
    } catch (e) {
      // ignore
    }
  }, []);

  // Intro sequence orchestration
  useEffect(() => {
    // If already in dashboard from session, skip intro
    if (sessionStorage.getItem('brandlens_session')) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      showLanding();
      return;
    }

    introFinishedRef.current = false;
    clearThoughtTimers();
    setSiteVisible(false);
    setThoughtsActive(false);
    setIntroDone(false);

    // After intro logo reveals (~3450ms)
    const tIntro = window.setTimeout(() => {
      setIntroDone(true);
      setThoughtsActive(true);

      // Sequence through each philosophical thought
      THOUGHTS.forEach((_, i) => {
        const tThought = window.setTimeout(() => {
          setActiveThoughtIndex(i);
        }, i * 1120 + 120);
        timersRef.current.push(tThought);
      });

      // Transition smoothly to landing site
      const tEnd = window.setTimeout(() => {
        showLanding();
      }, THOUGHTS.length * 1120 + 350);
      timersRef.current.push(tEnd);
    }, 3450);

    timersRef.current.push(tIntro);

    return () => {
      clearThoughtTimers();
    };
  }, [clearThoughtTimers, showLanding]);

  // Dynamic header phrase rotation on landing page
  useEffect(() => {
    if (!siteVisible || loginActive || dashboardActive) return;

    const interval = window.setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % HERO_PHRASES.length);
    }, 3800);

    return () => window.clearInterval(interval);
  }, [siteVisible, loginActive, dashboardActive]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!introFinishedRef.current && (e.key === 'Enter' || e.key === ' ')) {
        showLanding();
      }
      if (e.key === 'Escape' && loginActive) {
        closeLogin();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loginActive, showLanding]);

  // Interactive Water Caustics Canvas Animation & Physics
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    let time = 0;

    const render = () => {
      time += 0.015;
      ctx.clearRect(0, 0, width, height);

      // 1. Draw ethereal deep-water caustic waves
      const waveCount = 3;
      for (let w = 0; w < waveCount; w++) {
        ctx.beginPath();
        const yOffset = height * (0.35 + w * 0.18);
        const waveFreq = 0.0018 + w * 0.0006;
        const waveSpeed = time * (0.8 + w * 0.4);

        ctx.moveTo(0, yOffset);
        for (let x = 0; x <= width; x += 18) {
          const y =
            yOffset +
            Math.sin(x * waveFreq + waveSpeed) * 36 +
            Math.cos(x * 0.003 - time * 0.6) * 22;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, yOffset - 40, width, yOffset + 120);
        if (w === 0) {
          grad.addColorStop(0, 'rgba(166, 139, 255, 0.035)');
          grad.addColorStop(1, 'rgba(156, 236, 255, 0.0)');
        } else if (w === 1) {
          grad.addColorStop(0, 'rgba(156, 236, 255, 0.03)');
          grad.addColorStop(1, 'rgba(120, 105, 180, 0.0)');
        } else {
          grad.addColorStop(0, 'rgba(166, 139, 255, 0.025)');
          grad.addColorStop(1, 'rgba(8, 9, 13, 0)');
        }
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // 2. Render propagating water ripples
      const ripples = ripplesRef.current;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.radius += r.speed;
        r.alpha *= 0.965; // smooth natural decay

        if (r.alpha < 0.005 || r.radius > r.maxRadius) {
          ripples.splice(i, 1);
          continue;
        }

        // Concentric refractive caustic bands
        ctx.save();
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = r.color.replace('ALPHA', r.alpha.toFixed(3));
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Inner harmonic dispersion wave
        if (r.radius > 15) {
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.radius * 0.72, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(156, 236, 255, ${(r.alpha * 0.45).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Spawn water ripple helper
  const addRipple = useCallback((x: number, y: number, isStrong = false) => {
    ripplesRef.current.push({
      x,
      y,
      radius: 4,
      maxRadius: isStrong ? 260 : 160,
      alpha: isStrong ? 0.42 : 0.22,
      speed: isStrong ? 3.4 : 2.2,
      color: 'rgba(166, 139, 255, ALPHA)',
    });
    if (isStrong) {
      setTimeout(() => {
        ripplesRef.current.push({
          x: x + (Math.random() * 8 - 4),
          y: y + (Math.random() * 8 - 4),
          radius: 2,
          maxRadius: 220,
          alpha: 0.35,
          speed: 2.8,
          color: 'rgba(156, 236, 255, ALPHA)',
        });
      }, 70);
    }
  }, []);

  // Global click to trigger aquatic dispersion
  const handleGlobalClick = useCallback(
    (e: React.MouseEvent) => {
      addRipple(e.clientX, e.clientY, true);
    },
    [addRipple]
  );

  // Custom optical cursor & pointer movement tracking
  useEffect(() => {
    const finePointer = window.matchMedia('(pointer:fine)').matches;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setIsFinePointer(finePointer);

    if (!finePointer) return;

    let rafId: number;

    const handlePointerMove = (e: PointerEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY });
      ringTargetRef.current = { x: e.clientX, y: e.clientY };

      // Parallax motion for the ambient lens
      if (!reducedMotion && lensRef.current) {
        const xOffset = (e.clientX / window.innerWidth - 0.5) * 22;
        const yOffset = (e.clientY / window.innerHeight - 0.5) * 22;
        lensRef.current.style.transform = `translate(calc(-50% + ${xOffset}px), calc(-50% + ${yOffset}px))`;
      }

      // Hover check
      const target = e.target as HTMLElement | null;
      if (target) {
        const isInteractive = Boolean(
          target.closest('button, input, select, textarea, a, [role="button"], .demo-row, .wordmark, .phrase-dot, .intro-skip')
        );
        setCursorHovering(isInteractive);
      }
    };

    const handlePointerDown = () => setCursorClicking(true);
    const handlePointerUp = () => setCursorClicking(false);

    // Smooth physics loop for cursor ring
    const updateRing = () => {
      const ring = ringElRef.current;
      if (ring) {
        ringPosRef.current.x += (ringTargetRef.current.x - ringPosRef.current.x) * 0.16;
        ringPosRef.current.y += (ringTargetRef.current.y - ringPosRef.current.y) * 0.16;
        ring.style.left = `${ringPosRef.current.x}px`;
        ring.style.top = `${ringPosRef.current.y}px`;
      }
      rafId = requestAnimationFrame(updateRing);
    };
    rafId = requestAnimationFrame(updateRing);

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  // Load user data from server API
  const loadUserData = async (u: string) => {
    setLoadingData(true);
    try {
      const [fetchedPosts, fetchedMetrics] = await Promise.all([
        apiClient.fetchPosts(u),
        apiClient.fetchMetrics(u),
      ]);
      setPosts(fetchedPosts);
      setMetrics(fetchedMetrics);
    } catch (err) {
      console.error('Failed to load user data:', err);
    } finally {
      setLoadingData(false);
    }
  };

  const openLogin = () => {
    setLoginActive(true);
    setFormMessage({ text: '', isSuccess: false });
    if (!username) setUsername('employee');
    if (!password) setPassword('employee123');
    setTimeout(() => {
      usernameInputRef.current?.focus();
    }, 350);
  };

  const closeLogin = () => {
    setLoginActive(false);
    setSiteVisible(true);
  };

  const handleDemoFill = (u: string, p: string, r: Role) => {
    setUsername(u);
    setPassword(p);
    setRole(r);
    setFormMessage({ text: '', isSuccess: false });
    usernameInputRef.current?.focus();
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = username.trim().toLowerCase();
    const cleanPass = password;
    const selectedRole = role;

    if (!cleanUser || !cleanPass) {
      setFormMessage({
        text: 'Enter your username and password to continue.',
        isSuccess: false,
      });
      return;
    }

    const account = ACCOUNTS[cleanUser];
    if (!account || account.password !== cleanPass || account.role !== selectedRole) {
      setFormMessage({
        text: 'Those details do not match this workspace role. Please try again.',
        isSuccess: false,
      });
      return;
    }

    setFormMessage({
      text: 'Access verified. Opening workspace…',
      isSuccess: true,
    });

    const userSession = { username: cleanUser, role: account.role };
    sessionStorage.setItem('brandlens_session', JSON.stringify(userSession));
    setCurrentUser(userSession);

    await loadUserData(cleanUser);

    setTimeout(() => {
      setLoginActive(false);
      setSiteVisible(false);
      setDashboardActive(true);
      setActiveTab('dashboard');
      setFormMessage({ text: '', isSuccess: false });
    }, 550);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('brandlens_session');
    setCurrentUser(null);
    setDashboardActive(false);
    setLoginActive(true);
    setPassword('');
    setFormMessage({ text: '', isSuccess: false });
  };

  // Callback when a post is created
  const handlePostSaved = (newPost: PostRecord) => {
    setPosts((prev) => [newPost, ...prev]);
    if (currentUser) {
      apiClient.fetchMetrics(currentUser.username).then(setMetrics).catch(() => {});
    }
    setActiveTab('pending');
    setToastMessage(`Post "${newPost.title}" saved to Pending for Review.`);
    setTimeout(() => setToastMessage(null), 4500);
  };

  // Callback when a post is updated or status changed
  const handlePostUpdated = (updatedPost: PostRecord) => {
    setPosts((prev) => prev.map((p) => (p.id === updatedPost.id ? updatedPost : p)));
    if (currentUser) {
      apiClient.fetchMetrics(currentUser.username).then(setMetrics).catch(() => {});
    }
    const statusLabel =
      updatedPost.status === 'ready_to_post'
        ? 'Ready to Post'
        : updatedPost.status === 'posted'
        ? 'Posted'
        : 'Pending for Review';
    setToastMessage(`Post "${updatedPost.title}" updated (${statusLabel}).`);
    setTimeout(() => setToastMessage(null), 3500);
  };

  return (
    <div className="stage" onClick={handleGlobalClick}>
      {/* Interactive Watery Caustics Canvas */}
      <canvas ref={canvasRef} className="water-canvas" aria-hidden="true" />

      {/* Custom Optical Refraction Cursor (Fine Pointer Only) */}
      {isFinePointer && (
        <div className="custom-cursor-container" aria-hidden="true">
          <div
            className="custom-cursor-dot"
            style={{
              left: `${cursorPos.x}px`,
              top: `${cursorPos.y}px`,
              opacity: cursorPos.x < 0 ? 0 : 1,
            }}
          />
          <div
            ref={ringElRef}
            className={`custom-cursor-ring ${cursorHovering ? 'hovering' : ''} ${
              cursorClicking ? 'clicking' : ''
            }`}
            style={{
              opacity: cursorPos.x < 0 ? 0 : 1,
            }}
          />
        </div>
      )}

      {/* Ambient background atmosphere */}
      <div className="ambient" aria-hidden="true">
        <div className="haze" />
        <div className="lens" ref={lensRef}>
          <div className="lens-caustic-ring" />
        </div>
        <div className="light-streak" />
        <div className="light-streak two" />
        <span className="grain-dot" style={{ left: '17%', top: '26%', animationDelay: '1s' }} />
        <span className="grain-dot" style={{ left: '72%', top: '19%', animationDelay: '3s' }} />
        <span className="grain-dot" style={{ left: '81%', top: '72%', animationDelay: '2s' }} />
        <span className="grain-dot" style={{ left: '31%', top: '79%', animationDelay: '5s' }} />
        <span className="grain-dot" style={{ left: '60%', top: '63%', animationDelay: '4s' }} />
      </div>

      {/* Success Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 p-4 bg-[rgba(23,23,34,0.95)] border border-emerald-500/40 text-emerald-300 text-xs font-mono rounded-lg shadow-2xl backdrop-blur-xl flex items-center gap-3 animate-fade-in">
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Movable Floating BrandLens AI Assistant */}
      <FloatingAssistant
        isCurrentTabHelp={activeTab === 'help'}
        onFocusHelpPage={() => setActiveTab('help')}
      />

      {/* ========================================================
          FULL-STACK APPLICATION DASHBOARD
          ======================================================== */}
      {dashboardActive && currentUser ? (
        <div className="min-h-screen bg-[#08090d]/60 relative z-20 flex">
          {/* Responsive Sidebar */}
          <Sidebar
            currentTab={activeTab}
            onSelectTab={setActiveTab}
            username={currentUser.username}
            role={currentUser.role}
            onLogout={handleLogout}
            mobileOpen={mobileMenuOpen}
            onCloseMobile={() => setMobileMenuOpen(false)}
            pendingCount={metrics.pending}
          />

          {/* Main Content Area */}
          <div className="flex-1 lg:pl-72 flex flex-col min-h-screen">
            <Header
              title={
                activeTab === 'dashboard'
                  ? 'WORKSPACE DASHBOARD'
                  : activeTab === 'new-post'
                  ? 'CREATE NEW POST'
                  : activeTab === 'enhancer'
                  ? 'AI ENHANCER STUDIO'
                  : activeTab === 'pending'
                  ? 'PENDING POSTS QUEUE'
                  : activeTab === 'accounts'
                  ? 'CONNECTED SOCIAL ACCOUNTS'
                  : activeTab === 'data-security'
                  ? 'DATABASE & DATA SOVEREIGNTY'
                  : activeTab === 'help'
                  ? 'HELP ASSISTANT & SUPPORT'
                  : activeTab === 'about'
                  ? 'ABOUT & GOVERNANCE'
                  : 'ARCHIVED POST HISTORY'
              }
              subtitle={
                activeTab === 'dashboard'
                  ? 'Real-time overview of your authored content and brand review status'
                  : activeTab === 'new-post'
                  ? 'Draft social media post with AI text and image intelligence'
                  : activeTab === 'enhancer'
                  ? 'Multimodal AI suite for copy enhancement, visual safety audit, prompt synthesis, and document ingestion'
                  : activeTab === 'pending'
                  ? 'Posts currently awaiting review, adjustment, or publication'
                  : activeTab === 'accounts'
                  ? 'Manage social channels, OAuth credentials, and direct publishing permissions'
                  : activeTab === 'data-security'
                  ? 'Real local SQLite database status, data sovereignty export, and security hardening'
                  : activeTab === 'help'
                  ? 'AI workspace assistant and WhatsApp support channel'
                  : activeTab === 'about'
                  ? 'BrandLens principles, Nova Unlimited profile, and role-specific publishing policies'
                  : 'Comprehensive database records for your workspace account'
              }
              role={currentUser.role}
              onOpenMobile={() => setMobileMenuOpen(true)}
            />

            <main className="flex-1 p-6 lg:p-12 max-w-7xl w-full mx-auto">
              {activeTab === 'dashboard' && (
                <DashboardView
                  posts={posts}
                  metrics={metrics}
                  role={currentUser.role}
                  username={currentUser.username}
                  onPostUpdated={handlePostUpdated}
                  onCreateNew={() => setActiveTab('new-post')}
                />
              )}

              {activeTab === 'new-post' && (
                <NewPost
                  authorUsername={currentUser.username}
                  role={currentUser.role}
                  onPostSaved={handlePostSaved}
                  onCancel={() => setActiveTab('dashboard')}
                />
              )}

              {activeTab === 'enhancer' && (
                <EnhancerView
                  userRole={currentUser.role}
                  username={currentUser.username}
                  onSendToNewPost={(content) => {
                    // Navigate to new post editor
                    setActiveTab('new-post');
                  }}
                />
              )}

              {activeTab === 'pending' && (
                <PendingView
                  posts={posts}
                  username={currentUser.username}
                  onPostUpdated={handlePostUpdated}
                  onCreateNew={() => setActiveTab('new-post')}
                  onEditDraft={() => setActiveTab('new-post')}
                />
              )}

              {activeTab === 'history' && (
                <HistoryView
                  posts={posts}
                  username={currentUser.username}
                  onPostUpdated={handlePostUpdated}
                  onCreateNew={() => setActiveTab('new-post')}
                />
              )}

              {activeTab === 'accounts' && (
                <ConnectedAccountsView
                  username={currentUser.username}
                />
              )}

              {activeTab === 'data-security' && (
                <DataSecurityView />
              )}

              {activeTab === 'help' && (
                <HelpView />
              )}

              {activeTab === 'about' && (
                <AboutView
                  onNavigateToDashboard={() => setActiveTab('dashboard')}
                  onNavigateToHelp={() => setActiveTab('help')}
                />
              )}
            </main>
          </div>
        </div>
      ) : (
        <>
          {/* ========================================================
              ORIGINAL CINEMATIC INTRO SCREEN
              ======================================================== */}
          <section
            className={`intro ${introDone ? 'done' : ''}`}
            id="intro"
            aria-label="BrandLens introduction"
          >
            <div className="intro-core">
              <div className="intro-mark" />
              <h1 className="intro-name">
                Brand<span>Lens</span>
              </h1>
              <div className="intro-line" />
              <p className="intro-caption">CLARITY IN EVERY IMPRESSION</p>
            </div>
            <button
              className="intro-skip"
              id="skipIntro"
              onClick={(e) => {
                e.stopPropagation();
                showLanding();
              }}
              type="button"
            >
              SKIP INTRO ↗
            </button>
          </section>

          {/* Philosophical Thought Sequence */}
          <section
            className={`thoughts ${thoughtsActive ? 'active' : ''}`}
            id="thoughts"
            aria-hidden="true"
          >
            {THOUGHTS.map((thought, idx) => (
              <p
                key={idx}
                className={`thought ${activeThoughtIndex === idx ? 'active' : ''}`}
              >
                {thought}
              </p>
            ))}
          </section>

          {/* Main Landing Site */}
          <main className={`site ${siteVisible ? 'visible' : ''}`} id="site">
            <LandingPage
              onOpenLogin={() => {
                setGuestAboutOpen(false);
                openLogin();
              }}
              onOpenAbout={() => {
                setGuestAboutOpen(true);
              }}
              phraseIndex={phraseIndex}
              onCyclePhrase={(e) => {
                e.stopPropagation();
                setPhraseIndex((prev) => (prev + 1) % HERO_PHRASES.length);
                addRipple(e.clientX, e.clientY, true);
              }}
              onSetPhraseIndex={(pIdx) => {
                setPhraseIndex(pIdx);
              }}
              heroPhrases={HERO_PHRASES}
            />

            {/* Guest Full Governance / About Page Overlay */}
            {guestAboutOpen && (
              <div
                className="fixed inset-0 z-40 bg-[#08090d]/95 backdrop-blur-2xl overflow-y-auto pt-10 pb-20 px-4 sm:px-8 animate-fade-in"
                role="dialog"
                aria-modal="true"
                aria-label="BrandLens Governance Documentation"
              >
                <div className="max-w-6xl mx-auto">
                  <div className="flex items-center justify-between pb-6 mb-8 border-b border-white/[0.08]">
                    <div className="flex items-center gap-3">
                      <span className="brandmark" aria-hidden="true" />
                      <span className="font-mono text-sm text-white font-semibold">
                        BrandLens Documentation
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => {
                          setGuestAboutOpen(false);
                          openLogin();
                        }}
                        className="nav-enter"
                      >
                        <span>ENTER BRANDLENS</span>
                        <span aria-hidden="true">↗</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setGuestAboutOpen(false)}
                        className="px-3.5 py-2 rounded border border-white/10 hover:border-white/30 text-xs font-mono text-[#a4a3b2] hover:text-white transition-colors cursor-pointer"
                        aria-label="Close documentation"
                      >
                        ✕ Close
                      </button>
                    </div>
                  </div>

                  <AboutView
                    onClose={() => setGuestAboutOpen(false)}
                    onNavigateToHelp={() => {
                      setGuestAboutOpen(false);
                      openLogin();
                    }}
                  />
                </div>
              </div>
            )}
          </main>
        </>
      )}

      {/* ========================================================
          LOGIN VIEW OVERLAY (PRESERVED AESTHETIC & 3 DEMO ACCOUNTS)
          ======================================================== */}
      <section
        className={`login-view ${loginActive ? 'active' : ''}`}
        id="loginView"
        aria-label="Sign in"
      >
        <div
          className="login-backdrop"
          id="loginBackdrop"
          onClick={closeLogin}
        />
        <div className="login-panel" onClick={(e) => e.stopPropagation()}>
          <div className="login-top">
            <div className="login-brand">
              <span className="wordmark-icon" />
              BrandLens
            </div>
            <button
              className="close-login"
              id="closeLogin"
              aria-label="Back to landing page"
              onClick={closeLogin}
              type="button"
            >
              ×
            </button>
          </div>

          <h2>Enter your workspace.</h2>
          <p className="login-sub">A clearer view starts here.</p>

          <form id="loginForm" noValidate onSubmit={handleLoginSubmit}>
            <div className="field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                name="username"
                ref={usernameInputRef}
                autoComplete="username"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="input-wrap">
                <input
                  className="password-input"
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="show-pass"
                  id="showPass"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? 'HIDE' : 'SHOW'}
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="role">Workspace role</label>
              <select
                id="role"
                name="role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                <option value="Employee">Employee</option>
                <option value="Manager">Manager</option>
                <option value="Administrator">Administrator</option>
              </select>
            </div>

            <button className="sign-in" type="submit">
              SIGN IN <span aria-hidden="true">↗</span>
            </button>

            <p
              className="form-message"
              id="formMessage"
              role="status"
              aria-live="polite"
              style={formMessage.isSuccess ? { color: '#a8e8d0' } : undefined}
            >
              {formMessage.text}
            </p>
          </form>

          {/* Demo Quick-Fill Accounts (3 Demo accounts: Employee, Manager, Administrator) */}
          <div className="demo">
            <button
              className="demo-toggle"
              id="demoToggle"
              aria-expanded={demoOpen}
              onClick={() => setDemoOpen(!demoOpen)}
              type="button"
            >
              <span>DEMO ACCESS</span>
              <span id="demoChevron">{demoOpen ? '−' : '＋'}</span>
            </button>

            <div className={`demo-list ${demoOpen ? 'open' : ''}`} id="demoList">
              <button
                type="button"
                className="demo-row"
                onClick={() => handleDemoFill('employee', 'employee123', 'Employee')}
              >
                <span className="demo-role">Employee</span>
                <span className="demo-user">employee</span>
              </button>
              <button
                type="button"
                className="demo-row"
                onClick={() => handleDemoFill('manager', 'manager123', 'Manager')}
              >
                <span className="demo-role">Manager</span>
                <span className="demo-user">manager</span>
              </button>
              <button
                type="button"
                className="demo-row"
                onClick={() => handleDemoFill('admin', 'admin123', 'Administrator')}
              >
                <span className="demo-role">Administrator</span>
                <span className="demo-user">admin</span>
              </button>
              <p className="demo-note">Demo-only frontend login. Do not use real passwords.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
