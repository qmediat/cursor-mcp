export interface SessionEntry {
  id: string;
  model: string | undefined;
  mode: string | undefined;
  firstPrompt: string;
  createdAt: Date;
  lastUsedAt: Date;
  messageCount: number;
}

const MAX_PROMPT_LENGTH = 80;
const MAX_SESSIONS = 200;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  const codePoints = [...text];
  if (codePoints.length <= max) return text;
  return codePoints.slice(0, max - 1).join("") + "\u2026";
}

class SessionStore {
  private readonly sessions = new Map<string, SessionEntry>();

  record(
    id: string,
    prompt: string,
    meta: { model?: string; mode?: string } = {},
  ): void {
    const existing = this.sessions.get(id);
    if (existing) {
      existing.lastUsedAt = new Date();
      existing.messageCount++;
      if (meta.model) existing.model = meta.model;
      return;
    }
    this.sessions.set(id, {
      id,
      model: meta.model,
      mode: meta.mode,
      firstPrompt: truncate(normalize(prompt), MAX_PROMPT_LENGTH),
      createdAt: new Date(),
      lastUsedAt: new Date(),
      messageCount: 1,
    });
    this.evict();
  }

  list(): SessionEntry[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime(),
    );
  }

  private evict(): void {
    if (this.sessions.size <= MAX_SESSIONS) return;
    let oldest: string | undefined;
    let oldestTime = Infinity;
    for (const [id, entry] of this.sessions) {
      if (entry.lastUsedAt.getTime() < oldestTime) {
        oldestTime = entry.lastUsedAt.getTime();
        oldest = id;
      }
    }
    if (oldest) this.sessions.delete(oldest);
  }
}

export const sessionStore = new SessionStore();
