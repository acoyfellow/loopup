declare module 'cloudflare:workers' {
  export interface DurableObject {
    fetch(request: Request): Promise<Response>;
    alarm?(): void | Promise<void>;
  }

  export interface DurableObjectState {
    id: DurableObjectId;
    storage: DurableObjectStorage;
    waitUntil(promise: Promise<void>): void;
    setAlarm(alarm: number): void;
    getAlarm(): Promise<number | null>;
    blockConcurrencyWhile(callback: () => Promise<void>): Promise<void>;
  }

  export interface DurableObjectId {
    toString(): string;
    equals(other: DurableObjectId): boolean;
  }

  export interface DurableObjectStorage {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean>;
    list<T = unknown>(options?: { limit?: number; prefix?: string }): Promise<Map<string, T>>;
    sql: SqlStorage;
  }

  export interface SqlStorage {
    exec(query: string, ...bindings: unknown[]): SqlStorageCursor;
  }

  export interface SqlStorageCursor {
    toArray(): Record<string, unknown>[];
    one(): Record<string, unknown> | undefined;
    raw(): unknown[][];
  }

  export interface DurableObjectNamespace {
    newUniqueId(): DurableObjectId;
    idFromString(id: string): DurableObjectId;
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub;
  }

  export interface DurableObjectStub {
    fetch(request: Request): Promise<Response>;
    fetch(url: string): Promise<Response>;
  }

  export interface WebSocketPair {
    0: WebSocket;
    1: WebSocket;
  }

  const WebSocketPair: {
    new(): WebSocketPair;
  };
}

declare function WebSocketPair(): cloudflare_workers.WebSocketPair;