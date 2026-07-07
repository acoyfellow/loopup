interface DurableObjectState {
  id: { toString(): string };
  storage: {
    sql: SqlStorage;
    get<T = unknown>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    setAlarm(alarm: number): void;
    getAlarm(): Promise<number | null>;
  };
  waitUntil(promise: Promise<void>): void;
  blockConcurrencyWhile(callback: () => Promise<void>): Promise<void>;
}

interface SqlStorage {
  exec(query: string, ...bindings: unknown[]): SqlStorageCursor;
}

interface SqlStorageCursor {
  toArray(): Record<string, unknown>[];
  one(): Record<string, unknown> | undefined;
  raw(): unknown[][];
}

interface DurableObjectNamespace {
  newUniqueId(): { toString(): string };
  idFromString(id: string): { toString(): string };
  idFromName(name: string): { toString(): string };
  get(id: { toString(): string }): DurableObjectStub;
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
  fetch(url: string): Promise<Response>;
}

interface ResponseInit {
  webSocket?: WebSocket;
}