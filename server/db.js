import { neon } from "@neondatabase/serverless";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const localStore = {
  users: new Map(),
  threads: new Map()
};

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeName(value, email) {
  return String(value || "").trim() || email.split("@")[0] || "Focusmate user";
}

function createPasswordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$120000$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const hash = parts[3];
  const check = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const original = Buffer.from(hash, "hex");
  return original.length === check.length && timingSafeEqual(original, check);
}

function safeUser(user) {
  const { password: _password, passwordHash: _passwordHash, password_hash: _password_hash, ...safe } = user;
  return safe;
}

export function createDb(env = process.env) {
  const databaseUrl = env.DATABASE_URL || "";
  const sql = databaseUrl ? neon(databaseUrl) : null;
  let readyPromise = null;

  async function ensureSchema() {
    if (!sql) return;
    if (!readyPromise) {
      readyPromise = sql`
        create table if not exists focusmate_users (
          id text primary key,
          email text unique not null,
          name text not null,
          password_hash text not null default '',
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
        create table if not exists focusmate_threads (
          id text primary key,
          user_id text not null references focusmate_users(id) on delete cascade,
          title text not null,
          preview text not null,
          messages jsonb not null,
          session jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
        alter table focusmate_users add column if not exists password_hash text not null default '';
      `;
    }
    await readyPromise;
  }

  async function signup({ email, name, password: rawPassword }) {
    const cleanEmail = normalizeEmail(email);
    const cleanName = normalizeName(name, cleanEmail);
    const password = String(rawPassword || "");
    if (!cleanEmail) {
      throw new Error("Email is required");
    }
    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }
    const passwordHash = createPasswordHash(password);

    if (!sql) {
      const existing = [...localStore.users.values()].find((user) => user.email === cleanEmail);
      if (existing) {
        throw new Error("Account already exists");
      }
      const user = {
        id: createId("user"),
        email: cleanEmail,
        name: cleanName,
        passwordHash,
        createdAt: new Date().toISOString()
      };
      user.updatedAt = new Date().toISOString();
      localStore.users.set(user.id, user);
      return safeUser(user);
    }

    await ensureSchema();
    const id = createId("user");
    try {
      const rows = await sql`
        insert into focusmate_users (id, email, name, password_hash)
        values (${id}, ${cleanEmail}, ${cleanName}, ${passwordHash})
        returning id, email, name, created_at as "createdAt", updated_at as "updatedAt"
      `;
      return rows[0];
    } catch {
      throw new Error("Account already exists");
    }
  }

  async function login({ email, password: rawPassword }) {
    const cleanEmail = normalizeEmail(email);
    const password = String(rawPassword || "");
    if (!cleanEmail) {
      throw new Error("Email is required");
    }
    if (password.length < 6) {
      throw new Error("Password must be at least 6 characters");
    }

    if (!sql) {
      const user = [...localStore.users.values()].find((item) => item.email === cleanEmail);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        throw new Error("Invalid email or password");
      }
      user.updatedAt = new Date().toISOString();
      return safeUser(user);
    }

    await ensureSchema();
    const rows = await sql`
      select
        id,
        email,
        name,
        password_hash as "passwordHash",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from focusmate_users
      where email = ${cleanEmail}
      limit 1
    `;
    const user = rows[0];
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new Error("Invalid email or password");
    }
    await sql`
      update focusmate_users
      set updated_at = now()
      where id = ${user.id}
      returning id, email, name, created_at as "createdAt", updated_at as "updatedAt"
    `;
    return safeUser(user);
  }

  async function listThreads(userId) {
    if (!userId) return [];

    if (!sql) {
      return [...localStore.threads.values()]
        .filter((thread) => thread.userId === userId)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    await ensureSchema();
    return sql`
      select
        id,
        user_id as "userId",
        title,
        preview,
        messages,
        session,
        created_at as "createdAt",
        updated_at as "updatedAt"
      from focusmate_threads
      where user_id = ${userId}
      order by updated_at desc
      limit 50
    `;
  }

  async function upsertThread(userId, thread) {
    if (!userId) {
      throw new Error("User id is required");
    }

    const now = new Date().toISOString();
    const record = {
      id: thread.id || createId("thread"),
      userId,
      title: String(thread.title || "New focus").slice(0, 120),
      preview: String(thread.preview || thread.title || "New focus").slice(0, 240),
      messages: Array.isArray(thread.messages) ? thread.messages : [],
      session: thread.session || null,
      updatedAt: now,
      createdAt: thread.createdAt || now
    };

    if (!sql) {
      localStore.threads.set(record.id, record);
      return record;
    }

    await ensureSchema();
    const rows = await sql`
      insert into focusmate_threads (id, user_id, title, preview, messages, session)
      values (${record.id}, ${userId}, ${record.title}, ${record.preview}, ${JSON.stringify(record.messages)}::jsonb, ${JSON.stringify(record.session)}::jsonb)
      on conflict (id)
      do update set
        title = excluded.title,
        preview = excluded.preview,
        messages = excluded.messages,
        session = excluded.session,
        updated_at = now()
      returning
        id,
        user_id as "userId",
        title,
        preview,
        messages,
        session,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `;
    return rows[0];
  }

  async function deleteThread(userId, threadId) {
    if (!userId || !threadId) return;

    if (!sql) {
      const thread = localStore.threads.get(threadId);
      if (thread?.userId === userId) {
        localStore.threads.delete(threadId);
      }
      return;
    }

    await ensureSchema();
    await sql`delete from focusmate_threads where id = ${threadId} and user_id = ${userId}`;
  }

  return {
    provider: sql ? "neon" : "local",
    enabled: Boolean(sql),
    signup,
    login,
    listThreads,
    upsertThread,
    deleteThread
  };
}
