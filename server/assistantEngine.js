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

    recordUserMessage(message, rawMode, rawEnergy);

    if (llm?.enabled) {
      try {
        const reply = await llm.chatText(buildFlowMessages(message));
        return finalizeLlmReply(reply, message);
      } catch {
        return continueFallbackFlow(message);
      }
    }

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

  async function* handleMessageStream(rawMessage, rawMode = "start", rawEnergy = "medium") {
    const message = normalizeMessage(rawMessage);
    if (!message) {
      const emptyReply = assistantReply("What’s the smallest thing you can do right now?");
      yield { type: "final", data: emptyReply };
      return;
    }

    recordUserMessage(message, rawMode, rawEnergy);

    if (!llm?.enabled) {
      const fallback = await continueFallbackFlow(message);
      yield { type: "delta", content: fallback.reply };
      yield { type: "final", data: fallback };
      return;
    }

    try {
      let reply = "";
      for await (const chunk of llm.chatTextStream(buildFlowMessages(message))) {
        if (chunk.type === "thinking") {
          yield { type: "thinking", content: chunk.content };
          continue;
        }

        reply += chunk.content;
        yield { type: "delta", content: chunk.content };
      }

      const final = finalizeStreamedLlmReply(reply, message);
      yield { type: "final", data: final };
    } catch {
      const fallback = await continueFallbackFlow(message);
      yield { type: "delta", content: fallback.reply };
      yield { type: "final", data: fallback };
    }
  }

  function recordUserMessage(message, rawMode, rawEnergy) {
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
  }

  async function continueFallbackFlow(message) {
    const intent = classifyInput(message);

    if (intent.kind === "end") return endSession();
    if (intent.kind === "reset") {
      resetCurrentStep();
      session.state = "working";
      return assistantReply(`Reset done. ${capitalize(session.currentStep || smallestFallback())}.`);
    }
    if (intent.kind === "progress") {
      return intent.done ? completeCurrentStep() : handleState("stuck");
    }
    if (intent.kind === "state") return handleState(intent.state);
    if (session.mode === "resume" && session.currentStep) {
      session.state = "working";
      return assistantReply(`Resume here: ${session.currentStep}.`);
    }
    return startTask(message, session.mode, session.energy);
  }

  function buildFlowMessages(message) {
    return [
      {
        role: "system",
        content:
          "You are Focusmate, a concise ADHD-friendly focus assistant. You own the flow: infer whether the user is starting, done, stuck, distracted, switching, or wrapping up from the conversation. Do not follow a fixed script. Give one useful next move and optionally one short reason. Keep it natural, specific to the user's task, and under 45 words. Avoid shame, overplanning, lists, and generic productivity slogans."
      },
      {
        role: "user",
        content: `Current session JSON:\n${JSON.stringify(snapshotForLlm())}`
      },
      ...session.history.slice(-10).map((entry) => ({
        role: entry.role,
        content: entry.content
      })),
      {
        role: "user",
        content: `Mode: ${session.mode}. Energy: ${session.energy}. Latest user message: ${message}`
      }
    ];
  }

  function snapshotForLlm() {
    return {
      mode: session.mode,
      energy: session.energy,
      state: session.state,
      activeTask: session.activeTask,
      currentStep: session.currentStep,
      breadcrumb: session.breadcrumb,
      remainingSteps: session.remainingSteps,
      completedSteps: session.completedSteps,
      stepsSinceBreak: session.stepsSinceBreak,
      successStreak: session.successStreak,
      failuresInRow: session.failuresInRow
    };
  }

  async function finalizeLlmReply(rawReply, latestUserMessage) {
    const content = normalizeMessage(rawReply) || "I’m here. Tell me what changed, and I’ll choose the next move.";
    await updateSessionFromLlm(latestUserMessage, content);
    session.lastReplyAt = Date.now();
    session.history.push({ role: "assistant", content, at: session.lastReplyAt });
    return {
      reply: content,
      session: snapshot()
    };
  }

  function finalizeStreamedLlmReply(rawReply, latestUserMessage) {
    const content = normalizeMessage(rawReply) || "I’m here. Tell me what changed, and I’ll choose the next move.";
    applyLocalSessionUpdate(latestUserMessage, content);
    session.lastReplyAt = Date.now();
    session.history.push({ role: "assistant", content, at: session.lastReplyAt });
    return {
      reply: content,
      session: snapshot()
    };
  }

  async function updateSessionFromLlm(latestUserMessage, assistantReplyText) {
    try {
      const parsed = await llm?.chatJson(
        [
          {
            role: "user",
            content:
              `Update this focus session from the latest exchange. Let the assistant reply drive the next step; do not use any predefined workflow.\nCurrent session: ${JSON.stringify(snapshotForLlm())}\nLatest user: ${latestUserMessage}\nAssistant reply: ${assistantReplyText}`
          }
        ],
        'Schema: {"state":"idle|working|stuck|distracted|break|switching","activeTask":"task or null","currentStep":"single next step or null","breadcrumb":"restart note or null","remainingSteps":["optional upcoming steps"],"completedSteps":["completed steps"],"progressDelta":"none|completed|reset"}'
      );

      applyLlmSessionUpdate(parsed, latestUserMessage, assistantReplyText);
    } catch {
      applyLocalSessionUpdate(latestUserMessage, assistantReplyText);
    }
  }

  function applyLlmSessionUpdate(parsed, latestUserMessage, assistantReplyText) {
    const state = cleanTask(parsed?.state);
    if (["idle", "working", "stuck", "distracted", "break", "switching"].includes(state)) {
      session.state = state;
    } else {
      session.state = "working";
    }

    const task = cleanTask(parsed?.activeTask) || session.activeTask || inferTask(latestUserMessage);
    const step = cleanTask(parsed?.currentStep) || inferStep(assistantReplyText) || session.currentStep;

    session.activeTask = task || null;
    session.currentStep = step || null;
    session.breadcrumb = cleanTask(parsed?.breadcrumb) || (step ? `Next time: ${step}.` : session.breadcrumb);
    session.remainingSteps = Array.isArray(parsed?.remainingSteps)
      ? parsed.remainingSteps.map(cleanTask).filter(Boolean).slice(0, 8)
      : [];
    session.completedSteps = Array.isArray(parsed?.completedSteps)
      ? parsed.completedSteps.map(cleanTask).filter(Boolean).slice(0, 20)
      : session.completedSteps;

    if (parsed?.progressDelta === "completed") {
      session.stepsSinceBreak += 1;
      session.successStreak += 1;
      session.failuresInRow = 0;
    } else if (session.state === "stuck" || session.state === "distracted") {
      session.failuresInRow += 1;
      session.successStreak = 0;
    }

    if (task && !session.memory.activeTasks.includes(task)) {
      session.memory.activeTasks.push(task);
    }
  }

  function applyLocalSessionUpdate(latestUserMessage, assistantReplyText) {
    const intent = classifyInput(latestUserMessage);
    if (intent.kind === "progress" && intent.done && session.currentStep) {
      session.completedSteps.push(session.currentStep);
      session.successStreak += 1;
      session.failuresInRow = 0;
    } else if (intent.kind === "state") {
      session.state = intent.state;
    } else {
      session.state = "working";
    }

    session.activeTask = session.activeTask || inferTask(latestUserMessage);
    session.currentStep = inferStep(assistantReplyText) || session.currentStep || latestUserMessage;
    session.breadcrumb = session.currentStep ? `Next time: ${session.currentStep}.` : session.breadcrumb;

    if (session.activeTask && !session.memory.activeTasks.includes(session.activeTask)) {
      session.memory.activeTasks.push(session.activeTask);
    }
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
    handleMessageStream,
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

function inferTask(message) {
  const cleaned = cleanTask(message);
  if (!cleaned) return null;
  if (/^(done|finished|complete|completed|did it|stuck|distracted|break|too big|switch)$/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function inferStep(reply) {
  const cleaned = normalizeMessage(reply);
  if (!cleaned) return null;

  const patterns = [
    /\b(?:next|first|start(?: here)?|do this|try this|move):\s*([^.!?]+)/i,
    /\b(?:open|write|read|send|make|choose|pick|set|type|save|close|find|name|ask|draft|review)\b[^.!?]*/i
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      return cleanTask(match[1] || match[0]);
    }
  }

  return cleanTask(cleaned.split(/[.!?]/)[0]);
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
