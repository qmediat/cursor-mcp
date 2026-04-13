export class CursorCliError extends Error {
  constructor(
    public readonly exitCode: number | null,
    public readonly stderr: string,
    message: string,
  ) {
    super(message);
    this.name = "CursorCliError";
  }

  toMcpError(): string {
    const parts = [`Cursor CLI error: ${this.message}`];
    if (this.exitCode !== null) parts.push(`Exit code: ${this.exitCode}`);
    if (this.stderr) parts.push(`stderr: ${this.stderr}`);
    return parts.join("\n");
  }
}

export class CursorTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Cursor agent timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "CursorTimeoutError";
  }
}

export class CursorNotFoundError extends Error {
  constructor() {
    super(
      "cursor-agent binary not found. Install it: curl https://cursor.com/install -fsS | bash\n" +
      "Then authenticate: cursor-agent login",
    );
    this.name = "CursorNotFoundError";
  }
}

export class CursorAbortError extends Error {
  constructor() {
    super("Cursor agent execution was cancelled by the client.");
    this.name = "CursorAbortError";
  }
}
