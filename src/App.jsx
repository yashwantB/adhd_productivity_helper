import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CirclePause,
  CornerDownLeft,
  Github,
  Loader2,
  LogOut,
  Minus,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Sidebar,
  Split,
  TimerReset,
  X
} from "lucide-react";

const INACTIVITY_MINUTES = 3;
const INACTIVITY_MS = INACTIVITY_MINUTES * 60 * 1000;
const PARKING_KEY = "focusmate.parkingLot";
const THREADS_KEY = "focusmate.threads";
const USER_KEY = "focusmate.user";

const MODES = [
  { id: "start", label: "Start" },
  { id: "shrink", label: "Shrink" },
  { id: "unstuck", label: "Unstuck" },
  { id: "body", label: "Body double" },
  { id: "resume", label: "Resume" },
  { id: "switch", label: "Switch" },
  { id: "shutdown", label: "Shutdown" }
];

const ENERGY_LEVELS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" }
];

const STARTER_PROMPTS = [
  "I keep avoiding this assignment. Give me the first 2-minute step.",
  "I got distracted and lost my place. Help me restart.",
  "My task feels too big. Shrink it into one tiny action."
];

const QUICK_ACTIONS = [
  { label: "Done", message: "done", icon: Check },
  { label: "Stuck", message: "stuck", icon: CornerDownLeft },
  { label: "Distracted", message: "distracted", icon: TimerReset },
  { label: "Too big", message: "too big", icon: Minus },
  { label: "Break", message: "break", icon: CirclePause },
  { label: "Switch", message: "switch tasks", icon: Split }
];

const PUBLIC_PAGES = {
  about: {
    title: "About",
    intro: "Focusmate is built for the moment when a task is too fuzzy to start.",
    sections: [
      ["Purpose", "Turn vague work into one small next action, keep the session lightweight, and save the restart point."],
      ["Tone", "Calm, direct, and low-pressure. No dense task management ritual."],
      ["Storage", "Conversation history can sync through the configured Neon database flow after login."]
    ]
  },
  privacy: {
    title: "Privacy",
    intro: "A plain-language placeholder for how Focusmate handles account and conversation data.",
    sections: [
      ["Account data", "Login uses name, email, and password to create or restore an account."],
      ["Conversation data", "Saved threads include messages and session state so your focus history can be restored."],
      ["Control", "You can delete saved conversation threads from the sidebar. Replace this with reviewed legal text before production."]
    ]
  },
  terms: {
    title: "Terms",
    intro: "Basic product terms placeholder for development.",
    sections: [
      ["Use", "Focusmate is a planning and focus assistant, not professional, medical, legal, or academic advice."],
      ["Availability", "AI and database providers may be unavailable, rate limited, or return imperfect responses."],
      ["Responsibility", "Users are responsible for reviewing outputs before acting on them. Replace this with formal terms before launch."]
    ]
  }
};

const PUBLIC_PAGE_KEYS = Object.keys(PUBLIC_PAGES);

const firstAssistantMessage = {
  role: "assistant",
  content: "Name the thing. I’ll turn it into the next move.",
  at: Date.now()
};

export function App() {
  const auth = useAuth();
  const route = useRoute();
  const routeConversationId = getConversationId(route);
  const publicPageKey = getPublicPageKey(route);
  const controller = useAssistantController(auth.user, routeConversationId, navigateTo);
  const parking = useParkingLot();
  const apiHealth = useApiHealth();
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activePanel, setActivePanel] = useState("");
  const hasSession =
    Boolean(controller.session?.activeTask) ||
    Boolean(controller.session?.currentStep) ||
    controller.messages.some((message) => message.role === "user");

  useEffect(() => {
    if (route !== "/logout") return;
    auth.logout();
    navigateTo("/login", true);
  }, [auth, route]);

  useEffect(() => {
    if (!auth.user) return;
    if (route === "/" || route === "/login" || route === "/signup") {
      navigateTo(`/c/${controller.activeThreadId}`, true);
    }
  }, [auth.user, controller.activeThreadId, route]);

  if (route === "/" && !auth.user) {
    return (
      <LandingPage
        apiHealth={apiHealth}
        onGetStarted={() => navigateTo("/signup")}
        onLogin={() => navigateTo("/login")}
        onNavigate={(page) => navigateTo(`/${page}`)}
      />
    );
  }

  if (publicPageKey) {
    return (
      <PublicPage
        page={PUBLIC_PAGES[publicPageKey]}
        onBack={() => navigateTo(auth.user ? `/c/${controller.activeThreadId}` : "/")}
        onGetStarted={() => navigateTo(auth.user ? `/c/${controller.activeThreadId}` : "/signup")}
        onLogin={() => navigateTo(auth.user ? "/logout" : "/login")}
        onNavigate={(page) => navigateTo(`/${page}`)}
        isLoggedIn={Boolean(auth.user)}
      />
    );
  }

  if (!auth.user) {
    return (
      <AuthOverlay
        mode={route === "/signup" ? "signup" : "login"}
        auth={auth}
        apiHealth={apiHealth}
        onSuccess={() => navigateTo(`/c/${controller.activeThreadId}`, true)}
        onBack={() => navigateTo("/")}
        onSwitch={(mode) => navigateTo(`/${mode}`)}
      />
    );
  }

  return (
    <main className={isRailCollapsed ? "app-shell is-rail-collapsed" : "app-shell"}>
      <aside className="side-rail" aria-label="Workspace">
        <div className="rail-top">
          <button
            className="rail-icon"
            type="button"
            aria-label={isRailCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isRailCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isRailCollapsed}
            onClick={() => setIsRailCollapsed((current) => !current)}
          >
            <Sidebar size={18} aria-hidden="true" />
          </button>
          <div className="brand-lockup">Focusmate</div>
        </div>

        <button
          className="new-chat"
          type="button"
          onClick={controller.resetSession}
          disabled={controller.isSending}
        >
          New focus
        </button>

        <label className="rail-search">
          <Search size={17} aria-hidden="true" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search threads..."
            aria-label="Search threads"
          />
        </label>

        <SearchResults
          query={searchQuery}
          messages={controller.messages}
          threads={controller.threads}
          parkingItems={parking.items}
          onPick={(text) => controller.setInput(text)}
          onPickThread={controller.loadThread}
          onClear={() => setSearchQuery("")}
        />

        <ConversationHistory
          threads={controller.threads}
          activeThreadId={controller.activeThreadId}
          onSelect={controller.loadThread}
          onDelete={controller.deleteThread}
        />

        <ParkingLot parking={parking} query={searchQuery} />

        <button
          className="login-link"
          type="button"
          onClick={() => navigateTo("/logout")}
          aria-pressed={Boolean(auth.user)}
        >
          <LogOut size={18} aria-hidden="true" />
          <span>Logout</span>
        </button>
      </aside>

      <section className="chat-surface" aria-label="Focusmate chat">
        <header className="topbar">
          <div className="topbar-actions">
            <button
              className={activePanel === "settings" ? "icon-button is-active" : "icon-button"}
              type="button"
              aria-label="Settings"
              title="Settings"
              aria-expanded={activePanel === "settings"}
              onClick={() => setActivePanel((current) => (current === "settings" ? "" : "settings"))}
            >
              <Settings2 size={18} aria-hidden="true" />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={controller.resetSession}
              disabled={controller.isSending}
              aria-label="Reset session"
              title="Reset session"
            >
              <RotateCcw size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        <UtilityPanel
          activePanel={activePanel}
          controller={controller}
          parking={parking}
          apiHealth={apiHealth}
          user={auth.user}
          onLogin={() => navigateTo("/login")}
          onLogout={() => navigateTo("/logout")}
          onClose={() => setActivePanel("")}
        />

        <div className="chat-stage">
          <div className="prompt-stack">
            <FocusPanel session={controller.session} hasSession={hasSession} />
            <EnergyControls controller={controller} />
            <StarterPrompts controller={controller} hidden={hasSession} />
          </div>

          {hasSession ? <MessageStack controller={controller} /> : null}

          <div className="composer-dock">
            <Composer controller={controller} />
            <QuickActions controller={controller} disabled={!hasSession} />
            <ErrorBox error={controller.error} />
          </div>
        </div>
      </section>
    </main>
  );
}

function LandingPage({ apiHealth, onGetStarted, onLogin, onNavigate }) {
  const dbStatus = apiHealth?.databaseEnabled ? "Neon sync ready" : "Local fallback ready";

  return (
    <section className="landing-screen" aria-label="Focusmate landing">
      <header className="landing-nav">
        <div className="landing-brand">Focusmate</div>
        <nav className="landing-links" aria-label="Product pages">
          {PUBLIC_PAGE_KEYS.map((item) => (
            <button type="button" key={item} onClick={() => onNavigate(item)}>
              {PUBLIC_PAGES[item].title}
            </button>
          ))}
        </nav>
        <div className="landing-account-actions">
          <a
            className="github-link"
            href="https://github.com/yashwantB/adhd_productivity_helper"
            target="_blank"
            rel="noreferrer"
          >
            <Github size={17} aria-hidden="true" />
            <span>GitHub</span>
          </a>
          <button type="button" onClick={onLogin}>Login</button>
          <button type="button" onClick={onGetStarted}>Sign up</button>
        </div>
      </header>

      <div className="landing-scroll">
        <div className="landing-main">
          <div className="landing-copy">
            <h1>One next move. Then another.</h1>
            <p>
              A dark, low-friction focus assistant that turns messy tasks into a small action,
              keeps your place, and remembers the thread.
            </p>
            <div className="landing-actions">
              <button className="landing-primary" type="button" onClick={onGetStarted}>
                Get started
              </button>
            </div>
          </div>

          <div className="landing-preview" aria-hidden="true">
            <div>
              <span>Current focus</span>
              <strong>Open the document and write the rough title.</strong>
            </div>
            <div>
              <span>Energy</span>
              <strong>Low, distracted, restart-friendly</strong>
            </div>
            <div>
              <span>Storage</span>
              <strong>{dbStatus}</strong>
            </div>
          </div>
        </div>

        <section className="landing-flow" aria-label="Product flow">
          {[
            ["Start", "Drop in the messy task without organizing it first."],
            ["Narrow", "The assistant turns overwhelm into one action sized for your energy."],
            ["Return", "Saved threads keep the restart point when attention wanders."]
          ].map(([title, body], index) => (
            <article style={{ "--delay": `${index * 80}ms` }} key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h2>{title}</h2>
              <p>{body}</p>
            </article>
          ))}
        </section>

        <section className="landing-product" aria-label="Product preview">
          <div className="product-thread">
            <div className="product-row">
              <span>You</span>
              <p>I have to study, but I keep opening random tabs instead.</p>
            </div>
            <div className="product-row assistant-row">
              <span>Focusmate</span>
              <p>Close one tab, open the notes, and read only the first heading. Stop there.</p>
            </div>
            <div className="product-controls">
              <button type="button">Low</button>
              <button type="button">Done</button>
              <button type="button">Stuck</button>
            </div>
          </div>
          <div className="product-copy">
            <h2>Built for the first two minutes.</h2>
            <p>
              The interface stays quiet: energy is visible, deeper controls move into settings,
              and history lives where chat products normally put it.
            </p>
          </div>
        </section>

        <section className="landing-final" aria-label="Create account">
          <h2>Make a place you can come back to.</h2>
          <button className="landing-primary" type="button" onClick={onGetStarted}>
            Sign up
          </button>
        </section>
      </div>
    </section>
  );
}

function PublicPage({ page, onBack, onGetStarted, onLogin, onNavigate, isLoggedIn }) {
  return (
    <section className="landing-screen public-screen" aria-label={page.title}>
      <header className="landing-nav">
        <button type="button" onClick={onBack}>Back</button>
        <div className="landing-brand">Focusmate</div>
        <button type="button" onClick={onLogin}>{isLoggedIn ? "Logout" : "Login"}</button>
      </header>

      <main className="public-page">
        <div className="public-copy">
          <h1>{page.title}</h1>
          <p>{page.intro}</p>
        </div>
        <div className="public-sections">
          {page.sections.map(([title, body]) => (
            <section key={title}>
              <h2>{title}</h2>
              <p>{body}</p>
            </section>
          ))}
        </div>
        <footer className="public-footer">
          <button className="landing-primary" type="button" onClick={onGetStarted}>
            {isLoggedIn ? "Back to chat" : "Get started"}
          </button>
          <nav aria-label="More pages">
            {PUBLIC_PAGE_KEYS.map((item) => (
              <button type="button" key={item} onClick={() => onNavigate(item)}>
                {PUBLIC_PAGES[item].title}
              </button>
            ))}
          </nav>
        </footer>
      </main>
    </section>
  );
}

function AuthOverlay({ mode, auth, apiHealth, onSuccess, onBack, onSwitch }) {
  const [name, setName] = useState(auth.user?.name || "");
  const [email, setEmail] = useState(auth.user?.email || "");
  const [password, setPassword] = useState("");
  const isSignup = mode === "signup";

  async function submit(event) {
    event.preventDefault();
    try {
      if (isSignup) {
        await auth.signup({ name, email, password });
      } else {
        await auth.login({ email, password });
      }
      onSuccess?.();
    } catch {
      // useAuth owns the visible error state.
    }
  }

  return (
    <div className="auth-backdrop" role="presentation">
      <section className="auth-panel" aria-label={isSignup ? "Sign up" : "Login"}>
        <div className="auth-copy">
          <div className="auth-mark">Focusmate</div>
          <h1>{isSignup ? "Create your focus space." : "Welcome back."}</h1>
          <p>
            {isSignup
              ? "Make an account before chat so your conversation IDs and history can be saved."
              : "Use your email and password to restore saved focus threads."}
          </p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {isSignup ? (
            <label>
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Yash"
                required
              />
            </label>
          ) : null}
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 6 characters"
              minLength={6}
              required
            />
          </label>
          {auth.error ? <div className="auth-error">{auth.error}</div> : null}
          <button className="auth-submit" type="submit" disabled={auth.isLoading}>
            {auth.isLoading ? "Working" : isSignup ? "Create account" : "Login"}
          </button>
        </form>
        <div className="auth-switch">
          <button type="button" onClick={onBack}>Back</button>
          <button type="button" onClick={() => onSwitch(isSignup ? "login" : "signup")}>
            {isSignup ? "I already have an account" : "Create an account"}
          </button>
        </div>
        <div className="auth-db">
          <span>Database</span>
          <strong>{apiHealth?.databaseProvider || "checking"}</strong>
          <em>{apiHealth?.databaseEnabled ? "Neon sync active" : "Local fallback active"}</em>
        </div>
      </section>
    </div>
  );
}

function useRoute() {
  const [route, setRoute] = useState(() => window.location.pathname || "/");

  useEffect(() => {
    function syncRoute() {
      setRoute(window.location.pathname || "/");
    }

    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  return route;
}

function navigateTo(path, replace = false) {
  if (window.location.pathname === path) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", path);
  window.dispatchEvent(new Event("popstate"));
}

function getConversationId(route) {
  if (!route.startsWith("/c/")) return "";
  return decodeURIComponent(route.slice(3).split("/")[0] || "");
}

function getPublicPageKey(route) {
  const key = route.replace(/^\/+/, "");
  return PUBLIC_PAGES[key] ? key : "";
}

function useApiHealth() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let ignore = false;

    async function fetchHealth() {
      try {
        const data = await request("/api/health");
        if (!ignore) {
          setHealth(data);
        }
      } catch {
        if (!ignore) {
          setHealth({ ok: false });
        }
      }
    }

    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, []);

  return health;
}

function useAuth() {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function signup({ name, email, password }) {
    setIsLoading(true);
    setError("");
    try {
      const data = await request("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name, email, password })
      });
      window.localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setUser(data.user);
      return data.user;
    } catch (requestError) {
      setError(requestError.message);
      throw requestError;
    } finally {
      setIsLoading(false);
    }
  }

  async function login({ email, password }) {
    setIsLoading(true);
    setError("");
    try {
      const data = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      window.localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setUser(data.user);
      return data.user;
    } catch (requestError) {
      setError(requestError.message);
      throw requestError;
    } finally {
      setIsLoading(false);
    }
  }

  function logout() {
    window.localStorage.removeItem(USER_KEY);
    setUser(null);
  }

  return { user, error, isLoading, signup, login, logout };
}

function useAssistantController(user, routeThreadId, onThreadChange) {
  const [threads, setThreads] = useStoredThreads();
  const [activeThreadId, setActiveThreadId] = useState(() => routeThreadId || createThreadId());
  const [messages, setMessages] = useState([firstAssistantMessage]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("start");
  const [energy, setEnergy] = useState("medium");
  const [session, setSession] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const timerRef = useRef(null);
  const messageListRef = useRef(null);
  const shouldPersistRef = useRef(true);

  useEffect(() => {
    fetchSession();
  }, []);

  useEffect(() => {
    if (!shouldPersistRef.current || !hasUserMessages(messages)) return;

    const nextThread = buildThread(activeThreadId, messages, session);
    setThreads((current) => upsertThread(current, nextThread));
    if (user?.id) {
      saveRemoteThread(user.id, nextThread);
    }
  }, [activeThreadId, messages, session, setThreads, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    loadRemoteThreads(user.id, setThreads);
  }, [setThreads, user?.id]);

  useEffect(() => {
    if (!routeThreadId || isSending) return;

    const thread = threads.find((item) => item.id === routeThreadId);
    if (thread && (routeThreadId !== activeThreadId || !hasUserMessages(messages))) {
      applyLoadedThread(thread);
      return;
    }

    if (routeThreadId !== activeThreadId) {
      shouldPersistRef.current = false;
      setActiveThreadId(routeThreadId);
      setMessages([firstAssistantMessage]);
      setSession(null);
      setMode("start");
      setEnergy("medium");
      setError("");
      queueMicrotask(() => {
        shouldPersistRef.current = true;
      });
    }
  }, [activeThreadId, isSending, messages, routeThreadId, threads]);

  useEffect(() => {
    messageListRef.current?.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, isSending]);

  useEffect(() => {
    clearTimeout(timerRef.current);

    if (lastMessageRole(messages) === "assistant") {
      timerRef.current = setTimeout(() => {
        triggerTimeout();
      }, INACTIVITY_MS);
    }

    return () => clearTimeout(timerRef.current);
  }, [messages]);

  const canSubmit = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);

  async function fetchSession() {
    try {
      const data = await request("/api/session");
      setSession(data.session);
      setMode(data.session?.mode || "start");
      setEnergy(data.session?.energy || "medium");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function sendMessage(event, overrideMessage) {
    event?.preventDefault();
    const message = (overrideMessage || input).trim();
    if (!message || isSending) return;

    setIsSending(true);
    setError("");
    setInput("");
    const assistantMessageId = `assistant-${Date.now()}`;
    setMessages((current) => [
      ...current,
      { role: "user", content: message, mode, energy, at: Date.now() },
      { id: assistantMessageId, role: "assistant", content: "", thinking: "", at: Date.now(), streaming: true }
    ]);

    try {
      let finalData = null;
      await streamRequest("/api/message/stream", { message, mode, energy }, {
        onThinking(chunk) {
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantMessageId
                ? { ...item, thinking: `${item.thinking || ""}${chunk}`, streaming: true }
                : item
            )
          );
        },
        onDelta(chunk) {
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantMessageId
                ? { ...item, content: `${item.content}${chunk}`, streaming: true }
                : item
            )
          );
        },
        onFinal(data) {
          finalData = data;
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantMessageId
                ? { ...item, content: data.reply, streaming: false, at: Date.now() }
                : item
            )
          );
          setSession(data.session);
          setMode(data.session?.mode || mode);
          setEnergy(data.session?.energy || energy);
        }
      });

      if (!finalData) {
        throw new Error("Stream ended before the assistant finished.");
      }
    } catch (requestError) {
      setError(requestError.message);
      setMessages((current) => current.filter((item) => item.id !== assistantMessageId));
    } finally {
      setIsSending(false);
    }
  }

  async function triggerTimeout() {
    try {
      const data = await request("/api/timeout", {
        method: "POST",
        body: JSON.stringify({ minutes: INACTIVITY_MINUTES })
      });
      applyAssistantResponse(data);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function resetSession() {
    setIsSending(true);
    setError("");
    shouldPersistRef.current = true;

    try {
      const data = await request("/api/reset", { method: "POST" });
      const nextThreadId = createThreadId();
      setActiveThreadId(nextThreadId);
      onThreadChange?.(nextThreadId);
      setMessages([{ role: "assistant", content: data.reply, at: Date.now() }]);
      setSession(data.session);
      setMode(data.session?.mode || "start");
      setEnergy(data.session?.energy || "medium");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsSending(false);
    }
  }

  function loadThread(threadId) {
    const thread = threads.find((item) => item.id === threadId);
    if (!thread || isSending) return;

    applyLoadedThread(thread);
    onThreadChange?.(thread.id);
  }

  function applyLoadedThread(thread) {
    shouldPersistRef.current = false;
    setActiveThreadId(thread.id);
    setMessages(thread.messages);
    setSession(thread.session || null);
    setMode(thread.session?.mode || "start");
    setEnergy(thread.session?.energy || "medium");
    setError("");
    queueMicrotask(() => {
      shouldPersistRef.current = true;
    });
  }

  function deleteThread(threadId) {
    setThreads((current) => current.filter((thread) => thread.id !== threadId));
    if (user?.id) {
      deleteRemoteThread(user.id, threadId);
    }
    if (threadId === activeThreadId) {
      const nextThreadId = createThreadId();
      setActiveThreadId(nextThreadId);
      onThreadChange?.(nextThreadId);
      setMessages([firstAssistantMessage]);
    }
  }

  function applyAssistantResponse(data) {
    setMessages((current) => [
      ...current,
      { role: "assistant", content: data.reply, at: Date.now() }
    ]);
    setSession(data.session);
    setMode(data.session?.mode || mode);
    setEnergy(data.session?.energy || energy);
  }

  return {
    messages,
    input,
    setInput,
    mode,
    setMode,
    energy,
    setEnergy,
    session,
    isSending,
    error,
    canSubmit,
    messageListRef,
    sendMessage,
    resetSession,
    threads,
    activeThreadId,
    loadThread,
    deleteThread
  };
}

function useStoredThreads() {
  const [threads, setThreads] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(THREADS_KEY) || "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    window.localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
  }, [threads]);

  return [threads, setThreads];
}

async function loadRemoteThreads(userId, setThreads) {
  try {
    const data = await request("/api/threads", {
      headers: { "x-user-id": userId }
    });
    if (Array.isArray(data.threads)) {
      setThreads((current) => mergeThreads(data.threads, current));
    }
  } catch {
    // Keep local history available when the database is not configured.
  }
}

async function saveRemoteThread(userId, thread) {
  try {
    await request(`/api/threads/${thread.id}`, {
      method: "PUT",
      headers: { "x-user-id": userId },
      body: JSON.stringify(thread)
    });
  } catch {
    // Local history will sync again once the database is reachable.
  }
}

async function deleteRemoteThread(userId, threadId) {
  try {
    await request(`/api/threads/${threadId}`, {
      method: "DELETE",
      headers: { "x-user-id": userId }
    });
  } catch {
    // Local deletion already completed.
  }
}

function createThreadId() {
  return `thread-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasUserMessages(messages) {
  return messages.some((message) => message.role === "user");
}

function buildThread(threadId, messages, session) {
  const cleanMessages = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map(({ role, content, at, mode, energy }) => ({ role, content, at, mode, energy }))
    .filter((message) => message.content || message.role === "user");
  const title = cleanMessages.find((message) => message.role === "user")?.content || "New focus";
  return {
    id: threadId,
    title: title.slice(0, 80),
    preview: cleanMessages.at(-1)?.content || title,
    updatedAt: Date.now(),
    messages: cleanMessages,
    session
  };
}

function upsertThread(threads, nextThread) {
  return [nextThread, ...threads.filter((thread) => thread.id !== nextThread.id)].slice(0, 30);
}

function mergeThreads(primary, fallback) {
  const byId = new Map();
  [...fallback, ...primary].forEach((thread) => byId.set(thread.id, thread));
  return [...byId.values()]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 30);
}

function useParkingLot() {
  const [items, setItems] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem(PARKING_KEY) || "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    window.localStorage.setItem(PARKING_KEY, JSON.stringify(items));
  }, [items]);

  function addItem(text) {
    const clean = text.trim();
    if (!clean) return;
    setItems((current) => [{ id: Date.now(), text: clean }, ...current].slice(0, 12));
  }

  function removeItem(id) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function clearItems() {
    setItems([]);
  }

  return { items, addItem, removeItem, clearItems };
}

function SegmentedControl({ label, options, value, onChange, disabled }) {
  return (
    <fieldset className="segmented-control">
      <legend>{label}</legend>
      <div>
        {options.map((option) => (
          <button
            className={option.id === value ? "is-active" : ""}
            type="button"
            key={option.id}
            onClick={() => onChange(option.id)}
            disabled={disabled}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function EnergyControls({ controller }) {
  return (
    <section className="control-row" aria-label="Energy setting">
      <SegmentedControl
        label="Energy"
        options={ENERGY_LEVELS}
        value={controller.energy}
        onChange={controller.setEnergy}
        disabled={controller.isSending}
      />
    </section>
  );
}

function SearchResults({ query, messages, threads, parkingItems, onPick, onPickThread, onClear }) {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return null;

  const results = [
    ...threads
      .filter((thread) => `${thread.title} ${thread.preview}`.toLowerCase().includes(cleanQuery))
      .slice(0, 4)
      .map((thread) => ({ id: thread.id, label: "thread", text: thread.title, threadId: thread.id })),
    ...messages
      .filter((message) => message.content.toLowerCase().includes(cleanQuery))
      .slice(-4)
      .map((message) => ({ id: `${message.at}-${message.role}`, label: message.role, text: message.content })),
    ...parkingItems
      .filter((item) => item.text.toLowerCase().includes(cleanQuery))
      .slice(0, 4)
      .map((item) => ({ id: item.id, label: "parked", text: item.text }))
  ];

  return (
    <section className="search-results" aria-label="Search results">
      <div className="rail-section-title">
        <span>{results.length ? "Matches" : "No matches"}</span>
        <button type="button" onClick={onClear} aria-label="Clear search">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {results.map((result) => (
        <button
          className="search-result"
          type="button"
          key={result.id}
          onClick={() => (result.threadId ? onPickThread(result.threadId) : onPick(result.text))}
        >
          <span>{result.label}</span>
          <strong>{result.text}</strong>
        </button>
      ))}
    </section>
  );
}

function ConversationHistory({ threads, activeThreadId, onSelect, onDelete }) {
  return (
    <section className="conversation-history" aria-label="Conversation history">
      <div className="rail-section-title">
        <span>History</span>
      </div>
      <div className="thread-list">
        {threads.length ? (
          threads.map((thread) => (
            <div className={thread.id === activeThreadId ? "thread-item is-active" : "thread-item"} key={thread.id}>
              <button type="button" onClick={() => onSelect(thread.id)}>
                <strong>{thread.title}</strong>
                <span>{formatThreadTime(thread.updatedAt)}</span>
              </button>
              <button type="button" onClick={() => onDelete(thread.id)} aria-label={`Delete ${thread.title}`}>
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          ))
        ) : (
          <p>No conversations yet.</p>
        )}
      </div>
    </section>
  );
}

function formatThreadTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function FocusPanel({ session, hasSession }) {
  const completed = session?.completedSteps?.length || 0;
  const remaining = session?.remainingSteps?.length || 0;
  const total = hasSession ? Math.max(1, completed + remaining + (session?.currentStep ? 1 : 0)) : 0;
  const task = session?.activeTask || "No task yet";
  const step = session?.currentStep || "Type what you are trying to do.";
  const breadcrumb = session?.breadcrumb || "No saved place yet.";

  return (
    <section className="focus-panel" aria-label="Current focus">
      <div className="task-line">
        <div>
          <strong>{task}</strong>
        </div>
        <div className="session-state">{session?.state || "idle"}</div>
      </div>
      <div className="next-step">
        <p>{step}</p>
      </div>
      <div className="session-footer">
        <span>{hasSession ? `${completed}/${total} steps` : "Ready"}</span>
        <span>{breadcrumb}</span>
      </div>
    </section>
  );
}

function UtilityPanel({ activePanel, controller, parking, apiHealth, user, onLogin, onLogout, onClose }) {
  if (!activePanel) return null;

  return (
    <aside className="utility-panel" aria-label="Settings panel">
      <div className="utility-heading">
        <h2>Settings</h2>
        <button className="panel-close" type="button" onClick={onClose} aria-label="Close panel">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <SettingsPanel
        controller={controller}
        parking={parking}
        apiHealth={apiHealth}
        user={user}
        onLogin={onLogin}
        onLogout={onLogout}
      />
    </aside>
  );
}

function SettingsPanel({ controller, parking, apiHealth, user, onLogin, onLogout }) {
  const provider = apiHealth?.llmProvider || "unknown";
  const model = apiHealth?.llmModel || "not connected";
  const llmState = apiHealth?.llmEnabled ? "Enabled" : "Fallback";

  return (
    <div className="settings-stack">
      <div className="settings-row">
        <span>LLM</span>
        <strong>{llmState}</strong>
      </div>
      <div className="settings-note">{provider} / {model}</div>
      <div className="settings-group">
        <span>Mode</span>
        <SegmentedControl
          label="Mode"
          options={MODES}
          value={controller.mode}
          onChange={controller.setMode}
          disabled={controller.isSending}
        />
      </div>
      <div className="settings-row">
        <span>Account</span>
        <button type="button" onClick={user ? onLogout : onLogin}>
          {user ? "Logout" : "Login"}
        </button>
      </div>
      {user ? <div className="settings-note">Signed in as {user.email}</div> : null}
      <div className="settings-row">
        <span>Session</span>
        <button type="button" onClick={controller.resetSession} disabled={controller.isSending}>
          Reset
        </button>
      </div>
      <div className="settings-row">
        <span>Parking lot</span>
        <button type="button" onClick={parking.clearItems} disabled={!parking.items.length}>
          Clear
        </button>
      </div>
      <div className="settings-note">Idle nudge: {INACTIVITY_MINUTES} minutes</div>
    </div>
  );
}

function QuickActions({ controller, disabled }) {
  return (
    <section className="quick-actions" aria-label="Recovery controls">
      {QUICK_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            type="button"
            key={action.label}
            onClick={(event) => controller.sendMessage(event, action.message)}
            disabled={disabled || controller.isSending}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{action.label}</span>
          </button>
        );
      })}
    </section>
  );
}

function StarterPrompts({ controller, hidden }) {
  if (hidden) return null;

  return (
    <div className="starter-prompts">
      {STARTER_PROMPTS.map((prompt) => (
        <button
          type="button"
          key={prompt}
          onClick={(event) => controller.sendMessage(event, prompt)}
          disabled={controller.isSending}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}

function MessageStack({ controller }) {
  return (
    <section className="message-stack" ref={controller.messageListRef} aria-label="Conversation">
      {controller.messages.map((message, index) => (
        <article className={`message ${message.role}`} key={message.id || `${message.at}-${index}`}>
          <div className="message-name">{message.role === "assistant" ? "Focusmate" : "You"}</div>
          <div className={message.streaming ? "message-bubble is-streaming" : "message-bubble"}>
            {message.role === "assistant" && message.streaming && !message.content ? (
              <ThinkingDisclosure message={message} />
            ) : null}
            {message.streaming && !message.content ? null : message.content}
          </div>
        </article>
      ))}
    </section>
  );
}

function ThinkingDisclosure({ message }) {
  const hasThinking = Boolean(message.thinking);

  return (
    <details className="thinking-panel" open>
      <summary>
        <ThinkingDots label="Thinking" />
      </summary>
      <div className="thinking-summary">
        {hasThinking ? (
          <>
            <p>Reading the current task, mode, energy, and recent messages.</p>
            <p>Choosing a small next action that fits the session state.</p>
            <p>Preparing a short answer you can act on immediately.</p>
          </>
        ) : (
          <p>Waiting for the model to start streaming.</p>
        )}
      </div>
    </details>
  );
}

function ThinkingDots({ label = "Thinking" }) {
  return (
    <span className="thinking-bubble" role="status" aria-live="polite">
      <Loader2 size={15} aria-hidden="true" />
      <span>{label}</span>
      <span className="thinking-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

function Composer({ controller }) {
  return (
    <form className="composer" onSubmit={controller.sendMessage}>
      <input
        id="message"
        value={controller.input}
        onChange={(event) => controller.setInput(event.target.value)}
        placeholder="Type the task, blocker, or update"
        disabled={controller.isSending}
        aria-label="Message"
      />
      <button className="composer-tool" type="button" aria-label="Reset" title="Reset" onClick={controller.resetSession}>
        <RefreshCcw size={17} aria-hidden="true" />
      </button>
      <button className="send-button" type="submit" disabled={!controller.canSubmit} aria-label="Send message">
        <Send size={18} aria-hidden="true" />
      </button>
    </form>
  );
}

function ParkingLot({ parking, query }) {
  const [draft, setDraft] = useState("");
  const cleanQuery = query.trim().toLowerCase();
  const visibleItems = cleanQuery
    ? parking.items.filter((item) => item.text.toLowerCase().includes(cleanQuery))
    : parking.items;

  function submit(event) {
    event.preventDefault();
    parking.addItem(draft);
    setDraft("");
  }

  return (
    <aside className="parking-lot" aria-label="Parking lot">
      <div className="parking-heading">
        <h2>Parking lot</h2>
      </div>
      <form className="parking-form" onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Park a stray task"
          aria-label="Park a stray task"
        />
        <button type="submit" disabled={!draft.trim()} aria-label="Add parked task">
          <Plus size={17} aria-hidden="true" />
        </button>
      </form>
      <div className="parked-items">
        {visibleItems.length ? (
          visibleItems.map((item) => (
            <div className="parked-item" key={item.id}>
              <span>{item.text}</span>
              <button type="button" onClick={() => parking.removeItem(item.id)} aria-label={`Remove ${item.text}`}>
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          ))
        ) : (
          <p>{cleanQuery ? "No matching parked tasks." : "No parked tasks."}</p>
        )}
      </div>
    </aside>
  );
}

function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="error-box">{error}</div>;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function streamRequest(path, payload, handlers) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  const response = await fetch(path, {
    method: "POST",
    signal: controller.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).finally(() => clearTimeout(timeout));

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Stream request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const rawEvent of events) {
      const event = parseStreamEvent(rawEvent);
      if (event.type === "thinking") {
        handlers.onThinking?.(event.data);
      }
      if (event.type === "delta") {
        handlers.onDelta?.(event.data);
      }
      if (event.type === "final") {
        handlers.onFinal?.(event.data);
      }
      if (event.type === "error") {
        throw new Error(event.data || "Stream failed");
      }
    }
  }
}

function parseStreamEvent(rawEvent) {
  const lines = rawEvent.split("\n");
  const type = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");

  return {
    type,
    data: data ? JSON.parse(data) : null
  };
}

function lastMessageRole(messages) {
  return messages[messages.length - 1]?.role;
}
