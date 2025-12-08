/**
 * httpforger - Type definitions
 */

// ============================================================================
// Core Types and Interfaces
// ============================================================================

export interface RequestOptions {
  method?: string;
  path?: string;
  headers?: Map<string, string | string[]> | Record<string, string | string[]>;
  body?: string | Buffer;
}

export interface ConnectionOptions {
  host: string;
  port: number;
  protocol?: "http" | "https";
  timeout?: number;
  tls?: TLSOptions;
}

export interface TLSOptions {
  rejectUnauthorized?: boolean;
  servername?: string;
  minVersion?: string;
  maxVersion?: string;
  ciphers?: string;
  cert?: string;
  key?: string;
  ca?: string;
}

export interface TimingMetrics {
  startTime: number;
  connectTime?: number;
  tlsHandshakeTime?: number;
  firstByteTime?: number;
  endTime?: number;
  dnsLookupTime?: number;
  // Computed durations in ms
  connectionDuration?: number;
  tlsDuration?: number;
  ttfb?: number; // Time to first byte
  totalDuration?: number;
}

export interface RawResponse {
  raw: string;
  rawBuffer: Buffer;
  statusCode: number;
  statusMessage: string;
  httpVersion: string;
  headers: Map<string, string[]>;
  body: string;
  bodyBuffer: Buffer;
  parseError?: string;
  timing?: TimingMetrics;
}

export interface ProxyOptions {
  host: string;
  port: number;
  protocol?: "http" | "socks4" | "socks5";
  auth?: {
    username: string;
    password: string;
  };
}

export interface SendOptions extends ConnectionOptions {
  request: RequestOptions | string;
  proxy?: ProxyOptions;
  keepAlive?: boolean;
  collectTiming?: boolean;
}

export type MalformationType =
  | "space-before-colon"
  | "space-after-colon"
  | "tab-separator"
  | "no-space-after-colon"
  | "double-space"
  | "crlf-injection"
  | "lf-only"
  | "cr-only"
  | "null-byte"
  | "oversized-header"
  | "empty-header-name"
  | "empty-header-value";

export type EncodingType =
  | "url"
  | "double-url"
  | "unicode"
  | "hex"
  | "octal"
  | "html-entity"
  | "base64"
  | "overlong-utf8";

// ============================================================================
// Diff Types
// ============================================================================

export interface DiffResult {
  type: "added" | "removed" | "changed" | "unchanged";
  path: string;
  oldValue?: string;
  newValue?: string;
}

export interface RequestDiff {
  method: DiffResult | null;
  path: DiffResult | null;
  httpVersion: DiffResult | null;
  headers: DiffResult[];
  body: DiffResult | null;
  raw: string;
}

export interface ResponseDiff {
  statusCode: DiffResult | null;
  statusMessage: DiffResult | null;
  httpVersion: DiffResult | null;
  headers: DiffResult[];
  body: DiffResult | null;
  timing?: {
    ttfbDiff?: number;
    totalDiff?: number;
  };
}

// ============================================================================
// Connection Pool Types
// ============================================================================

export interface PooledConnection {
  socket: ReturnType<typeof Bun.connect> extends Promise<infer T> ? T : never;
  host: string;
  port: number;
  protocol: "http" | "https";
  lastUsed: number;
  inUse: boolean;
}

// ============================================================================
// Fetch / Unified Client Types
// ============================================================================

/** Options for fetch-based requests */
export interface FetchRequestOptions {
  url?: string;
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: BodyInit | null;
  redirect?: RequestRedirect;
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  mode?: RequestMode;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  integrity?: string;
  keepalive?: boolean;
  /** Collect timing metrics using Performance API */
  collectTiming?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
}

/** Unified response that works across all backends */
export interface UnifiedResponse {
  /** Whether the request was successful (status 200-299) */
  ok: boolean;
  /** HTTP status code */
  status: number;
  /** HTTP status text */
  statusText: string;
  /** Response headers */
  headers: Map<string, string[]>;
  /** Response body as string */
  body: string;
  /** Response body as Buffer */
  bodyBuffer: Buffer;
  /** HTTP version (1.0, 1.1, 2) */
  httpVersion: string;
  /** Timing metrics if collected */
  timing?: TimingMetrics;
  /** The backend used for this request */
  backend: "fetch" | "raw" | "http2";

  // Backend-specific data
  /** Raw HTTP response string (for raw/http2 backends) */
  raw?: string;
  /** Original fetch Response object (for fetch backend) */
  fetchResponse?: Response;
  /** HTTP/2 frames (for http2 backend) */
  frames?: unknown[];
}

/** Client mode for unified HttpClient */
export type ClientMode = "fetch" | "raw" | "http2";

/** Options for unified HttpClient */
export interface HttpClientOptions {
  /** Default timeout for all requests (ms) */
  defaultTimeout?: number;
  /** Default mode for requests */
  defaultMode?: ClientMode;
  /** Default TLS options for raw/http2 */
  defaultTls?: TLSOptions;
  /** Whether to collect timing by default */
  collectTiming?: boolean;
}

/** Unified request options for HttpClient */
export interface UnifiedRequestOptions {
  // URL-based (for fetch mode)
  url?: string;

  // Host-based (for raw/http2 modes)
  host?: string;
  port?: number;
  protocol?: "http" | "https";

  // Request details
  method?: string;
  path?: string;
  headers?: Record<string, string | string[]> | Map<string, string | string[]>;
  body?: string | Buffer | BodyInit;

  // Options
  timeout?: number;
  tls?: TLSOptions;
  proxy?: ProxyOptions;
  keepAlive?: boolean;
  collectTiming?: boolean;

  // Fetch-specific
  redirect?: RequestRedirect;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  mode?: RequestMode;
}
