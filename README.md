# Focusmate

Small full-stack ADHD focus assistant that turns vague or stalled work into one next action, tracks session progress, nudges after inactivity, and helps the user recover without shame.

The product surface is intentionally narrow: current task, next step, quick recovery controls, energy level, conversation history, and a small parking lot for side tasks. The assistant loop is built around starting, shrinking, resuming, switching, and saving a breadcrumb for the next restart.

## Run

```bash
npm install
npm run dev
```

App: `http://localhost:5173`

Backend: `http://localhost:8787`

## LLM Setup

The backend uses OpenAI-compatible chat completions when `LLM_ENABLED=true`.

OpenRouter is the default LLM provider:

```bash
LLM_PROVIDER=openrouter
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=sk-or-your-key
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_SITE_URL=http://localhost:5173
OPENROUTER_APP_NAME=Focusmate
LLM_REASONING_EFFORT=low
LLM_TIMEOUT_MS=8000
LLM_ENABLED=true
```

The OpenRouter site URL and app name headers are optional, but they identify the app in OpenRouter usage analytics. The backend still works with any OpenAI-compatible server by setting `LLM_PROVIDER=compatible` and the `OPENAI_*` variables:

```bash
LLM_PROVIDER=compatible
OPENAI_BASE_URL=http://localhost:1234/v1
OPENAI_API_KEY=lm-studio
OPENAI_MODEL=local-model
LLM_ENABLED=true
```

If the LLM is disabled, unavailable, or missing an API key, the deterministic fallback still runs the assistant loop.
