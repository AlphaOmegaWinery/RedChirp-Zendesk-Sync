// Plain JSON lines, readable in Replit's console and deployment logs.
export function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));
}
