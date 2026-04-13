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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
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
      firstPrompt: truncate(prompt, MAX_PROMPT_LENGTH),
      createdAt: new Date(),
      lastUsedAt: new Date(),
      messageCount: 1,
    });
  }

  list(): SessionEntry[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime(),
    );
  }
}

export const sessionStore = new SessionStore();
