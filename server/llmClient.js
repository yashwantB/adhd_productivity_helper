const jsonHeaders = {
  "Content-Type": "application/json"
};

const providers = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyName: "OPENROUTER_API_KEY",
    modelName: "OPENROUTER_MODEL",
    defaultModel: "openai/gpt-4o-mini"
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    apiKeyName: "OPENAI_API_KEY",
    modelName: "OPENAI_MODEL",
    defaultModel: "gpt-4o-mini"
  },
  compatible: {
    baseUrl: "http://localhost:1234/v1",
    apiKeyName: "OPENAI_API_KEY",
    modelName: "OPENAI_MODEL",
    defaultModel: "local-model"
  }
};

function stripCodeFence(value) {
  return value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function buildConfig(env) {
  const provider = env.LLM_PROVIDER || (env.OPENROUTER_API_KEY ? "openrouter" : "compatible");
  const providerConfig = providers[provider] || providers.compatible;
  const baseUrl = provider === "openrouter"
    ? env.OPENROUTER_BASE_URL || providerConfig.baseUrl
    : env.OPENAI_BASE_URL || providerConfig.baseUrl;
  const apiKey = env[providerConfig.apiKeyName] || env.OPENAI_API_KEY || "";
  const model = env[providerConfig.modelName] || env.OPENAI_MODEL || providerConfig.defaultModel;
  const enabled = env.LLM_ENABLED === "true" && Boolean(apiKey);
  const timeoutMs = Number(env.LLM_TIMEOUT_MS || 12000);
  const reasoningEffort = env.LLM_REASONING_EFFORT || (provider === "openrouter" ? "low" : "");

  return {
    enabled,
    provider,
    baseUrl,
    apiKey,
    model,
    reasoningEffort,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 12000
  };
}

function attributionHeaders(env, provider) {
  if (provider !== "openrouter") {
    return {};
  }

  return {
    ...(env.OPENROUTER_SITE_URL ? { "HTTP-Referer": env.OPENROUTER_SITE_URL } : {}),
    ...(env.OPENROUTER_APP_NAME ? { "X-OpenRouter-Title": env.OPENROUTER_APP_NAME } : {})
  };
}

function timeoutAfter(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`LLM request timed out after ${ms}ms`)), ms);
  });
}

function buildRequestBody(config, messages, schemaHint) {
  return {
    model: config.model,
    temperature: 0.2,
    ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}),
    messages: [
      {
        role: "system",
        content: `Return only compact JSON. ${schemaHint}`
      },
      ...messages
    ]
  };
}

function buildTextRequestBody(config, messages, stream = false) {
  return {
    model: config.model,
    temperature: 0.45,
    stream,
    ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}),
    messages
  };
}

function extractStreamParts(payload) {
  return payload.choices
    ?.map((choice) => {
      const delta = choice.delta || choice.message || {};
      return {
        content: delta.content || "",
        thinking: delta.reasoning || delta.reasoning_content || delta.thinking || ""
      };
    }) || [];
}

export function createLlmClient(env = process.env) {
  const config = buildConfig(env);

  async function chatJson(messages, schemaHint) {
    if (!config.enabled) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    const request = fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        ...jsonHeaders,
        ...attributionHeaders(env, config.provider),
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(buildRequestBody(config, messages, schemaHint))
    });

    const response = await Promise.race([
      request.finally(() => clearTimeout(timeout)),
      timeoutAfter(config.timeoutMs).finally(() => controller.abort())
    ]);

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status}`);
    }

    const body = await response.json();
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }

    return JSON.parse(stripCodeFence(content));
  }

  async function chatText(messages) {
    if (!config.enabled) {
      return "";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    const request = fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        ...jsonHeaders,
        ...attributionHeaders(env, config.provider),
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(buildTextRequestBody(config, messages))
    });

    const response = await Promise.race([
      request.finally(() => clearTimeout(timeout)),
      timeoutAfter(config.timeoutMs).finally(() => controller.abort())
    ]);

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status}`);
    }

    const body = await response.json();
    return body.choices?.[0]?.message?.content || "";
  }

  async function* chatTextStream(messages) {
    if (!config.enabled) {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        ...jsonHeaders,
        ...attributionHeaders(env, config.provider),
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(buildTextRequestBody(config, messages, true))
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        for (const line of part.split("\n")) {
          const clean = line.trim();
          if (!clean.startsWith("data:")) continue;

          const data = clean.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          for (const part of extractStreamParts(JSON.parse(data))) {
            if (part.thinking) {
              yield { type: "thinking", content: part.thinking };
            }
            if (part.content) {
              yield { type: "delta", content: part.content };
            }
          }
        }
      }
    }
  }

  return {
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    chatJson,
    chatText,
    chatTextStream
  };
}
