import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  CirclePause,
  CornerDownLeft,
  Loader2,
  Minus,
  Plus,
  RefreshCcw,
  RotateCcw,
  Send,
  Split,
  TimerReset
} from "lucide-react";

const INACTIVITY_MINUTES = 3;
const INACTIVITY_MS = INACTIVITY_MINUTES * 60 * 1000;
const PARKING_KEY = "focusmate.parkingLot";

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
  "Help me choose the smallest useful next action.",
  "I fell off. Help me restart.",
  "This feels too big. Shrink it."
];

const QUICK_ACTIONS = [
  { label: "Done", message: "done", icon: Check },
  { label: "Stuck", message: "stuck", icon: CornerDownLeft },
  { label: "Distracted", message: "distracted", icon: TimerReset },
  { label: "Too big", message: "too big", icon: Minus },
  { label: "Break", message: "break", icon: CirclePause },
  { label: "Switch", message: "switch tasks", icon: Split }
];

const firstAssistantMessage = {
  role: "assistant",
  content: "Name the thing. I’ll turn it into the next move.",
  at: Date.now()
};

export function App() {
  const controller = useAssistantController();
  const parking = useParkingLot();
  const hasSession =
    Boolean(controller.session?.activeTask) ||
    Boolean(controller.session?.currentStep) ||
    controller.messages.some((message) => message.role === "user");

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Focusmate</h1>
          <p>One next move, then recover cleanly.</p>
        </div>
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
      </header>

      <section className="control-row" aria-label="Session settings">
        <SegmentedControl
          label="Mode"
          options={MODES}
          value={controller.mode}
          onChange={controller.setMode}
          disabled={controller.isSending}
        />
        <SegmentedControl
          label="Energy"
          options={ENERGY_LEVELS}
          value={controller.energy}
          onChange={controller.setEnergy}
          disabled={controller.isSending}
        />
      </section>

      <section className="workspace">
        <div className="focus-column">
          <FocusPanel session={controller.session} hasSession={hasSession} />
          <QuickActions controller={controller} disabled={!hasSession} />
          <StarterPrompts controller={controller} hidden={hasSession} />
          <MessageStack controller={controller} />
          <Composer controller={controller} />
          <ErrorBox error={controller.error} />
        </div>
        <ParkingLot parking={parking} />
      </section>
    </main>
  );
}

function useAssistantController() {
  const [messages, setMessages] = useState([firstAssistantMessage]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("start");
  const [energy, setEnergy] = useState("medium");
  const [session, setSession] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const timerRef = useRef(null);
  const messageListRef = useRef(null);

  useEffect(() => {
    fetchSession();
  }, []);

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
    setMessages((current) => [
      ...current,
      { role: "user", content: message, mode, energy, at: Date.now() }
    ]);

    try {
      const data = await request("/api/message", {
        method: "POST",
        body: JSON.stringify({ message, mode, energy })
      });
      applyAssistantResponse(data);
    } catch (requestError) {
      setError(requestError.message);
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

    try {
      const data = await request("/api/reset", { method: "POST" });
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
    resetSession
  };
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

  return { items, addItem, removeItem };
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
          <span>Task</span>
          <strong>{task}</strong>
        </div>
        <div className="session-state">{session?.state || "idle"}</div>
      </div>
      <div className="next-step">
        <span>Next</span>
        <p>{step}</p>
      </div>
      <div className="session-footer">
        <span>{hasSession ? `${completed}/${total} steps` : "Ready"}</span>
        <span>{breadcrumb}</span>
      </div>
    </section>
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
        <article className={`message ${message.role}`} key={`${message.at}-${index}`}>
          <div className="message-name">{message.role === "assistant" ? "Focusmate" : "You"}</div>
          <div className="message-bubble">{message.content}</div>
        </article>
      ))}
      {controller.isSending ? <ThinkingMessage /> : null}
    </section>
  );
}

function ThinkingMessage() {
  return (
    <article className="message assistant">
      <div className="message-name">Focusmate</div>
      <div className="message-bubble thinking-bubble" role="status" aria-live="polite">
        <Loader2 size={15} aria-hidden="true" />
        <span>Working</span>
      </div>
    </article>
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
      <button className="send-button" type="submit" disabled={!controller.canSubmit} aria-label="Send message">
        <Send size={18} aria-hidden="true" />
      </button>
    </form>
  );
}

function ParkingLot({ parking }) {
  const [draft, setDraft] = useState("");

  function submit(event) {
    event.preventDefault();
    parking.addItem(draft);
    setDraft("");
  }

  return (
    <aside className="parking-lot" aria-label="Parking lot">
      <div className="parking-heading">
        <h2>Parking lot</h2>
        <p>Capture side quests without switching.</p>
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
        {parking.items.length ? (
          parking.items.map((item) => (
            <div className="parked-item" key={item.id}>
              <span>{item.text}</span>
              <button type="button" onClick={() => parking.removeItem(item.id)} aria-label={`Remove ${item.text}`}>
                <ArrowUp size={15} aria-hidden="true" />
              </button>
            </div>
          ))
        ) : (
          <p>No parked tasks.</p>
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

function lastMessageRole(messages) {
  return messages[messages.length - 1]?.role;
}
