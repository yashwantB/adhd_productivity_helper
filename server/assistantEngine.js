const SESSION_ID = "local";
const DEFAULT_STEP_SIZE = 2;
const BREAK_AFTER_STEPS = 5;
const INACTIVITY_LIMIT = 3;
const LONG_INACTIVITY_LIMIT = 9;

const starterSteps = {
  read: ["open the reading material", "read one paragraph", "write one short note"],
  write: ["open a blank note", "write one rough sentence", "clean up that sentence"],
  study: ["open the chapter or notes", "read the first heading", "write one line you remember"],
  code: ["open the project", "find the file you need", "make one small edit"],
  clean: ["pick one visible item", "put it where it belongs", "clear one small surface"],
  default: ["open the thing", "look at the first small part", "do one tiny action"]
};

const modeInstructions = {
  start: "Find the smallest useful first action. Keep momentum practical and direct.",
  shrink: "Make the task dramatically smaller. Prefer actions that take under two minutes.",
  unstuck: "Assume the user is blocked. Diagnose gently, then give one recovery move.",
  sprint: "Create a short work sprint with clear steps that can be completed in one session.",
  body: "Act like a quiet body double. Keep the user oriented and ask for tiny updates.",
  resume: "Restore the user's place and make the restart step nearly effortless.",
  switch: "Help switch tasks without losing the current place.",
  shutdown: "End cleanly by saving a breadcrumb for the next session."
};

const energyInstructions = {
  low: "Use ultra-small actions that can be started in under 30 seconds.",
  medium: "Use modest actions that keep momentum without overplanning.",
  high: "Use a slightly larger action only when it is still concrete and immediate."
};

export function createAssistantEngine({ llm }) {
  let session = freshSession();

  function freshSession() {
    return {
      id: SESSION_ID,
      mode: "start",
      energy: "medium",
      state: "idle",
      activeTask: null,
      currentStep: null,
      breadcrumb: null,
      remainingSteps: [],
      completedSteps: [],
      lastReplyAt: null,
      lastMessageAt: null,
      stepsSinceBreak: 0,
      failuresInRow: 0,
      successStreak: 0,
      history: [],
      memory: {
        activeTasks: [],
        lastSuccessfulStepSize: DEFAULT_STEP_SIZE,
        distractionFrequency: 0
      }
    };
  }

  function snapshot() {
    return {
      ...session,
      llmEnabled: Boolean(llm?.enabled)
    };
  }

  async function handleMessage(rawMessage, rawMode = "start", rawEnergy = "medium") {
    const message = normalizeMessage(rawMessage);
    if (!message) {
      return assistantReply("What’s the smallest thing you can do right now?");
    }

    session.mode = normalizeMode(rawMode);
    session.energy = normalizeEnergy(rawEnergy);
    session.lastMessageAt = Date.now();
    session.history.push({
      role: "user",
      content: message,
      mode: session.mode,
      energy: session.energy,
      at: session.lastMessageAt
    });

    const intent = classifyInput(message);

    if (intent.kind === "end") {
      return endSession();
    }

    if (intent.kind === "reset") {
      resetCurrentStep();
      session.state = "working";
      return assistantReply(`Reset done. ${capitalize(session.currentStep || smallestFallback())}.`);
    }

    if (intent.kind === "progress") {
      if (intent.done) {
        return completeCurrentStep();
      }

      session.failuresInRow += 1;
      session.successStreak = 0;
      shrinkStep();
      return assistantReply(`That’s okay. ${capitalize(session.currentStep || smallestFallback())}.`);
    }

    if (intent.kind === "state") {
      return handleState(intent.state);
    }

    if (session.mode === "resume" && session.currentStep) {
      session.state = "working";
      return assistantReply(`Resume here: ${session.currentStep}.`);
    }

    return startTask(message, session.mode, session.energy);
  }

  async function startTask(message, mode = "start", energy = "medium") {
    session.state = "working";

    const { task: normalized, steps } = await planTask(message, mode, energy);

    session.activeTask = normalized;
    session.currentStep = steps[0] || smallestFallback();
    session.breadcrumb = `Next time: ${session.currentStep}.`;
    session.remainingSteps = steps.slice(1);
    session.completedSteps = [];
    session.stepsSinceBreak = 0;
    session.failuresInRow = 0;
    session.successStreak = 0;

    if (!session.memory.activeTasks.includes(normalized)) {
      session.memory.activeTasks.push(normalized);
    }

    return assistantReply(`Start here: ${session.currentStep}.`);
  }

  function handleState(state) {
    session.state = state;

    if (state === "stuck") {
      session.failuresInRow += 1;
      shrinkStep();
      return assistantReply(`No problem. ${capitalize(session.currentStep || smallestFallback())}.`);
    }

    if (state === "tooBig") {
      session.failuresInRow += 1;
      session.mode = "shrink";
      shrinkStep();
      return assistantReply(`Make it smaller: ${session.currentStep || smallestFallback()}.`);
    }

    if (state === "break") {
      session.breadcrumb = `After the break: ${session.currentStep || smallestFallback()}.`;
      return assistantReply("Take a short break.");
    }

    if (state === "distracted") {
      session.memory.distractionFrequency += 1;
      resetCurrentStep();
      return assistantReply(`Come back gently. ${capitalize(session.currentStep || smallestFallback())}.`);
    }

    if (state === "switching") {
      session.breadcrumb = `Return to ${session.activeTask || "this task"}: ${
        session.currentStep || smallestFallback()
      }.`;
      session.state = "switching";
      return assistantReply("Saved your place. Type the next task, or park it and stay here.");
    }

    if (state === "shutdown") {
      session.breadcrumb = `Restart here: ${session.currentStep || smallestFallback()}.`;
      session.state = "idle";
      return assistantReply(`Saved for next time: ${session.currentStep || smallestFallback()}.`);
    }

    if (state === "working") {
      return assistantReply(`Good. ${capitalize(session.currentStep || smallestFallback())}.`);
    }

    return assistantReply("What’s the smallest thing you can do right now?");
  }

  function completeCurrentStep() {
    const completed = session.currentStep;
    if (completed) {
      session.completedSteps.push(completed);
    }

    session.state = "working";
    session.failuresInRow = 0;
    session.successStreak += 1;
    session.stepsSinceBreak += 1;
    session.memory.lastSuccessfulStepSize = Math.min(
      5,
      session.memory.lastSuccessfulStepSize + (session.successStreak >= 2 ? 1 : 0)
    );

    if (session.stepsSinceBreak >= BREAK_AFTER_STEPS) {
      session.stepsSinceBreak = 0;
      session.state = "break";
      return assistantReply("Nice, take a 3 minute break.");
    }

    session.currentStep = session.remainingSteps.shift() || nextGeneratedStep();
    session.breadcrumb = `Next time: ${session.currentStep}.`;

    return assistantReply(`Good. ${capitalize(session.currentStep)}.`);
  }

  function handleTimeout(minutes = INACTIVITY_LIMIT) {
    const safeMinutes = Number.isFinite(minutes) ? minutes : INACTIVITY_LIMIT;
    session.state = "distracted";
    session.memory.distractionFrequency += 1;

    if (safeMinutes >= LONG_INACTIVITY_LIMIT) {
      resetCurrentStep();
    }

    session.breadcrumb = `Restart here: ${session.currentStep || smallestFallback()}.`;
    return assistantReply("Still there? Just do the smallest step.");
  }

  function endSession() {
    const completed = session.completedSteps.length;
    const task = session.activeTask || "your task";
    session.breadcrumb = `Restart here: ${session.currentStep || smallestFallback()}.`;
    const line = completed
      ? `You finished ${completed} step${completed === 1 ? "" : "s"} toward ${task}.`
      : `You started ${task}.`;

    const reply = assistantReply(line);
    session = freshSession();
    return reply;
  }

  function reset() {
    session = freshSession();
    return assistantReply("Reset done. What’s the smallest thing you can do right now?");
  }

  function resetCurrentStep() {
    session.failuresInRow += 1;
    session.successStreak = 0;
    session.currentStep = smallestStepForTask(session.activeTask);
    session.breadcrumb = `Restart here: ${session.currentStep}.`;
  }

  function shrinkStep() {
    const task = session.activeTask || "the task";
    const tiny = smallestStepForTask(task);
    if (session.currentStep && session.currentStep !== tiny) {
      session.remainingSteps.unshift(session.currentStep);
    }
    session.currentStep = tiny;
    session.breadcrumb = `Restart here: ${tiny}.`;
  }

  function nextGeneratedStep() {
    const verb = verbForTask(session.activeTask || "");
    const size = Math.max(1, session.memory.lastSuccessfulStepSize);
    if (size <= 2) {
      return starterSteps[verb]?.[1] || starterSteps.default[1];
    }
    return starterSteps[verb]?.[2] || starterSteps.default[2];
  }

  async function planTask(message, mode = "start", energy = "medium") {
    const safeMode = normalizeMode(mode);
    const safeEnergy = normalizeEnergy(energy);
    const fallbackTask = deterministicNormalize(message);
    const fallbackSteps = deterministicChunk(fallbackTask, safeMode, safeEnergy);

    try {
      const parsed = await llm?.chatJson(
        [
          {
            role: "user",
            content:
              `Mode: ${safeMode}. ${modeInstructions[safeMode]} Energy: ${safeEnergy}. ${energyInstructions[safeEnergy]} Turn this user request into one concrete task and 3-7 short imperative steps. Request: ${message}`
          }
        ],
        'Schema: {"task":"concrete task","steps":["short imperative step"]}'
      );
      const task = cleanTask(parsed?.task) || fallbackTask;
      const steps = Array.isArray(parsed?.steps)
        ? parsed.steps.map(cleanTask).filter(Boolean).slice(0, 7)
        : [];
      return {
        task,
        steps: steps.length ? steps : deterministicChunk(task, safeMode, safeEnergy)
      };
    } catch {
      return {
        task: fallbackTask,
        steps: fallbackSteps
      };
    }
  }

  async function normalizeTask(message) {
    const fallback = deterministicNormalize(message);

    try {
      const parsed = await llm?.chatJson(
        [
          {
            role: "user",
            content: `Normalize this vague user task into one concrete task that can begin immediately: ${message}`
          }
        ],
        'Schema: {"task":"concrete task"}'
      );
      return cleanTask(parsed?.task) || fallback;
    } catch {
      return fallback;
    }
  }

  async function chunkTask(task) {
    const fallback = deterministicChunk(task);

    try {
      const parsed = await llm?.chatJson(
        [
          {
            role: "user",
            content:
              `Break this task into 1-5 minute micro-steps. Return 3-7 imperative steps. Task: ${task}`
          }
        ],
        'Schema: {"steps":["short imperative step"]}'
      );
      const steps = Array.isArray(parsed?.steps)
        ? parsed.steps.map(cleanTask).filter(Boolean).slice(0, 7)
        : [];
      return steps.length ? steps : fallback;
    } catch {
      return fallback;
    }
  }

  function assistantReply(text) {
    const content = enforceReplyRules(text);
    session.lastReplyAt = Date.now();
    session.history.push({ role: "assistant", content, at: session.lastReplyAt });
    return {
      reply: content,
      session: snapshot()
    };
  }

  return {
    snapshot,
    handleMessage,
    handleTimeout,
    reset
  };
}

function classifyInput(message) {
  const lower = message.toLowerCase();

  if (/\b(end|stop|finish session|quit)\b/.test(lower)) {
    return { kind: "end" };
  }

  if (/\b(wasted time|restart|reset|start over)\b/.test(lower)) {
    return { kind: "reset" };
  }

  if (/\b(done|finished|complete|completed|did it)\b/.test(lower)) {
    return { kind: "progress", done: true };
  }

  if (/\b(not done|didn't|did not|failed|couldn't|could not)\b/.test(lower)) {
    return { kind: "progress", done: false };
  }

  if (/\b(too big|too much|too hard|shrink|smaller)\b/.test(lower)) {
    return { kind: "state", state: "tooBig" };
  }

  if (/\b(stuck|can't|cannot|overwhelmed|confused)\b/.test(lower)) {
    return { kind: "state", state: "stuck" };
  }

  if (/\b(bored|distracted|scrolling|lost focus|procrastinating)\b/.test(lower)) {
    return { kind: "state", state: "distracted" };
  }

  if (/\b(tired|break|rest)\b/.test(lower)) {
    return { kind: "state", state: "break" };
  }

  if (/\b(switch|change tasks|another task)\b/.test(lower)) {
    return { kind: "state", state: "switching" };
  }

  if (/\b(shutdown|wrap up|save my place)\b/.test(lower)) {
    return { kind: "state", state: "shutdown" };
  }

  if (/\b(ready|back|working)\b/.test(lower)) {
    return { kind: "state", state: "working" };
  }

  return { kind: "task" };
}

function deterministicNormalize(message) {
  const cleaned = cleanTask(message);
  const lower = cleaned.toLowerCase();

  if (/^study\b/.test(lower)) {
    return cleaned.replace(/^study\b/i, "read").replace(/\s*$/, " chapter 1");
  }

  if (/^learn\b/.test(lower)) {
    return cleaned.replace(/^learn\b/i, "read an introduction to");
  }

  if (cleaned.split(/\s+/).length <= 3) {
    return `make a small start on ${cleaned}`;
  }

  return cleaned;
}

function deterministicChunk(task, mode = "start", energy = "medium") {
  if (energy === "low") {
    return [
      "put the work in front of you",
      "touch one visible part",
      "do it for 30 seconds",
      "type what happened"
    ];
  }

  if (mode === "shrink") {
    return [
      "open the thing",
      "touch the smallest visible part",
      "do it for two minutes",
      "stop and type what happened"
    ];
  }

  if (mode === "unstuck") {
    return [
      "name what feels blocked",
      "remove one source of friction",
      "try the smallest next move",
      "type what changed"
    ];
  }

  if (mode === "sprint") {
    return [
      "set a 10 minute timer",
      "open the work",
      "do the first small step",
      "mark where to continue"
    ];
  }

  if (mode === "body") {
    return [
      "open the work",
      "type what you are starting",
      "work for three minutes",
      "type done, stuck, or distracted"
    ];
  }

  if (mode === "resume") {
    return [
      "open the last place",
      "read the saved breadcrumb",
      "do the restart step",
      "type what changed"
    ];
  }

  if (mode === "switch") {
    return [
      "save the current place",
      "name the next task",
      "choose one tiny first step",
      "start for two minutes"
    ];
  }

  if (mode === "shutdown") {
    return [
      "write the next restart step",
      "close the work",
      "leave the materials easy to reopen"
    ];
  }

  const lower = task.toLowerCase();
  const verb = verbForTask(lower);
  const base = starterSteps[verb] || starterSteps.default;

  if (verb === "study" || verb === "read") {
    return [
      "open the notes or chapter",
      "read the first heading",
      "read one paragraph",
      "write one short note",
      "mark the next place to continue"
    ];
  }

  if (verb === "write") {
    return [
      "open a blank note",
      "write one rough sentence",
      "add one detail",
      "fix one awkward word",
      "save the note"
    ];
  }

  if (verb === "code") {
    return [
      "open the project",
      "find the smallest relevant file",
      "read one function",
      "make one small edit",
      "run one quick check"
    ];
  }

  return [
    base[0],
    base[1],
    base[2],
    "pause and type done"
  ];
}

function smallestStepForTask(task) {
  const verb = verbForTask(task || "");
  return starterSteps[verb]?.[0] || starterSteps.default[0];
}

function smallestFallback() {
  return starterSteps.default[0];
}

function verbForTask(task) {
  const lower = task.toLowerCase();
  if (/\b(read|chapter|book|notes|study|os|operating system)\b/.test(lower)) return "read";
  if (/\b(write|essay|draft|note)\b/.test(lower)) return "write";
  if (/\b(code|bug|project|implement|build)\b/.test(lower)) return "code";
  if (/\b(clean|room|desk)\b/.test(lower)) return "clean";
  return "default";
}

function normalizeMessage(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeMode(value) {
  return Object.hasOwn(modeInstructions, value) ? value : "start";
}

function normalizeEnergy(value) {
  return Object.hasOwn(energyInstructions, value) ? value : "medium";
}

function cleanTask(value) {
  return normalizeMessage(value).replace(/[.!?]+$/g, "");
}

function capitalize(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function enforceReplyRules(text) {
  const cleaned = normalizeMessage(text);
  const sentences = cleaned.match(/[^.!?]+[.!?]?/g) || [cleaned];
  return sentences
    .slice(0, 2)
    .map((sentence) => sentence.trim())
    .join(" ")
    .trim();
}
