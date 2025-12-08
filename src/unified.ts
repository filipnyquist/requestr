/**
 * httpforger - Unified HTTP Client
 * Swiss-army knife HTTP client supporting fetch, raw HTTP/1.x, and HTTP/2
 */

import type {
  HttpClientOptions,
  UnifiedResponse,
  UnifiedRequestOptions,
  TLSOptions,
  TimingMetrics,
  SendOptions,
} from "./types";
import type { Http2RequestOptions } from "./http2";
import { RequestBuilder } from "./builder";
import { FetchClient } from "./fetch";
import { RawHttp } from "./client";
import { Http2Client } from "./http2";

export interface HttpClientResponse extends UnifiedResponse {
  /** Response analyzer for convenience methods */
  analyzer: UnifiedResponseAnalyzer;
}

/**
 * Extended response analyzer that works with UnifiedResponse
 */
export class UnifiedResponseAnalyzer {
  constructor(private response: UnifiedResponse) {}

  /**
   * Check if response body contains a string
   */
  bodyContains(search: string, caseSensitive = true): boolean {
    if (caseSensitive) {
      return this.response.body.includes(search);
    }
    return this.response.body.toLowerCase().includes(search.toLowerCase());
  }

  /**
   * Check if response body matches a regex
   */
  bodyMatches(pattern: RegExp): boolean {
    return pattern.test(this.response.body);
  }

  /**
   * Check if a header exists
   */
  hasHeader(name: string): boolean {
    return this.response.headers.has(name.toLowerCase());
  }

  /**
   * Get header value(s)
   */
  getHeader(name: string): string[] | undefined {
    return this.response.headers.get(name.toLowerCase());
  }

  /**
   * Get first header value
   */
  getFirstHeader(name: string): string | undefined {
    const values = this.response.headers.get(name.toLowerCase());
    return values?.[0];
  }

  /**
   * Check if header contains a value
   */
  headerContains(name: string, search: string, caseSensitive = true): boolean {
    const values = this.response.headers.get(name.toLowerCase());
    if (!values) return false;

    for (const value of values) {
      if (caseSensitive) {
        if (value.includes(search)) return true;
      } else {
        if (value.toLowerCase().includes(search.toLowerCase())) return true;
      }
    }
    return false;
  }

  /**
   * Check status code
   */
  hasStatus(code: number): boolean {
    return this.response.status === code;
  }

  /**
   * Check if status is in range
   */
  hasStatusInRange(min: number, max: number): boolean {
    return this.response.status >= min && this.response.status <= max;
  }

  /**
   * Check if response indicates success (2xx)
   */
  isSuccess(): boolean {
    return this.response.ok;
  }

  /**
   * Check if response indicates redirect (3xx)
   */
  isRedirect(): boolean {
    return this.hasStatusInRange(300, 399);
  }

  /**
   * Check if response indicates client error (4xx)
   */
  isClientError(): boolean {
    return this.hasStatusInRange(400, 499);
  }

  /**
   * Check if response indicates server error (5xx)
   */
  isServerError(): boolean {
    return this.hasStatusInRange(500, 599);
  }

  /**
   * Get Content-Length value
   */
  getContentLength(): number | undefined {
    const value = this.getFirstHeader("content-length");
    return value ? parseInt(value, 10) : undefined;
  }

  /**
   * Get Content-Type value
   */
  getContentType(): string | undefined {
    return this.getFirstHeader("content-type");
  }

  /**
   * Get all cookies from Set-Cookie headers
   */
  getCookies(): string[] {
    return this.response.headers.get("set-cookie") || [];
  }

  /**
   * Get the response body
   */
  getBody(): string {
    return this.response.body;
  }

  /**
   * Get the response body as Buffer
   */
  getBodyBuffer(): Buffer {
    return this.response.bodyBuffer;
  }

  /**
   * Get timing metrics if available
   */
  getTiming(): TimingMetrics | undefined {
    return this.response.timing;
  }
}

/**
 * Unified HTTP Client
 * Supports multiple backends: fetch (standard), raw (HTTP/1.x), and http2
 */
export class HttpClient {
  private fetchClient: FetchClient;
  private rawClient: RawHttp;
  private http2Client: Http2Client;
  private options: HttpClientOptions;

  constructor(options?: HttpClientOptions) {
    this.options = {
      defaultTimeout: options?.defaultTimeout ?? 30000,
      defaultMode: options?.defaultMode ?? "fetch",
      defaultTls: options?.defaultTls,
      collectTiming: options?.collectTiming ?? false,
    };

    this.fetchClient = new FetchClient({
      defaultTimeout: this.options.defaultTimeout,
      collectTiming: this.options.collectTiming,
    });

    this.rawClient = new RawHttp({
      defaultTimeout: this.options.defaultTimeout,
    });

    this.http2Client = new Http2Client({
      defaultTimeout: this.options.defaultTimeout,
    });
  }

  // ==========================================================================
  // Static Factory Methods
  // ==========================================================================

  /**
   * Create a new RequestBuilder
   */
  static request(): RequestBuilder {
    return new RequestBuilder();
  }

  /**
   * Quick GET request using fetch
   */
  static async get(
    url: string,
    options?: { headers?: Record<string, string>; timeout?: number }
  ): Promise<HttpClientResponse> {
    const client = new HttpClient();
    return client.fetch(url, { method: "GET", ...options });
  }

  /**
   * Quick POST request using fetch
   */
  static async post(
    url: string,
    body?: BodyInit | Record<string, unknown>,
    options?: { headers?: Record<string, string>; timeout?: number }
  ): Promise<HttpClientResponse> {
    const client = new HttpClient();
    const processedBody =
      typeof body === "object" &&
      !(body instanceof FormData) &&
      !(body instanceof URLSearchParams)
        ? JSON.stringify(body)
        : body;
    const headers =
      typeof body === "object" &&
      !(body instanceof FormData) &&
      !(body instanceof URLSearchParams)
        ? { "Content-Type": "application/json", ...options?.headers }
        : options?.headers;
    return client.fetch(url, {
      method: "POST",
      body: processedBody as BodyInit,
      headers,
      timeout: options?.timeout,
    });
  }

  // ==========================================================================
  // Fetch-based Requests (Standard HTTP)
  // ==========================================================================

  /**
   * Send a request using fetch (standard, well-behaved HTTP)
   */
  async fetch(
    urlOrBuilder: string | RequestBuilder,
    options?: UnifiedRequestOptions
  ): Promise<HttpClientResponse> {
    let url: string;
    let fetchOptions: Parameters<FetchClient["request"]>[0];

    if (urlOrBuilder instanceof RequestBuilder) {
      url = urlOrBuilder.buildUrl();
      const init = urlOrBuilder.buildFetchInit();
      const headersObj: Record<string, string> = {};
      init.headers.forEach((value, key) => {
        headersObj[key] = value;
      });
      fetchOptions = {
        url,
        method: init.method,
        headers: headersObj,
        body: init.body,
        collectTiming: options?.collectTiming ?? this.options.collectTiming,
        timeout: options?.timeout ?? this.options.defaultTimeout,
        redirect: options?.redirect,
        credentials: options?.credentials,
        cache: options?.cache,
        mode: options?.mode,
      };
    } else {
      url = urlOrBuilder;
      fetchOptions = {
        url,
        method: options?.method ?? "GET",
        headers: this.normalizeHeaders(options?.headers),
        body: options?.body as BodyInit,
        collectTiming: options?.collectTiming ?? this.options.collectTiming,
        timeout: options?.timeout ?? this.options.defaultTimeout,
        redirect: options?.redirect,
        credentials: options?.credentials,
        cache: options?.cache,
        mode: options?.mode,
      };
    }

    const response = await this.fetchClient.request(fetchOptions);
    return this.wrapResponse(response);
  }

  // ==========================================================================
  // Raw HTTP/1.x Requests (Full Control)
  // ==========================================================================

  /**
   * Send a raw HTTP/1.x request (full control, supports malformation)
   */
  async raw(
    optionsOrBuilder: SendOptions | RequestBuilder
  ): Promise<HttpClientResponse> {
    let sendOptions: SendOptions;

    if (optionsOrBuilder instanceof RequestBuilder) {
      const conn = optionsOrBuilder.getConnectionOptions();
      sendOptions = {
        host: conn.host,
        port: conn.port,
        protocol: conn.protocol,
        request: optionsOrBuilder.build(),
        collectTiming: this.options.collectTiming,
        timeout: this.options.defaultTimeout,
        tls: this.options.defaultTls,
      };
    } else {
      sendOptions = {
        ...optionsOrBuilder,
        collectTiming:
          optionsOrBuilder.collectTiming ?? this.options.collectTiming,
        timeout: optionsOrBuilder.timeout ?? this.options.defaultTimeout,
        tls: optionsOrBuilder.tls ?? this.options.defaultTls,
      };
    }

    const response = await this.rawClient.sendRequest(sendOptions);

    // Convert RawResponse to UnifiedResponse
    const unified: UnifiedResponse = {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      statusText: response.statusMessage,
      headers: response.headers,
      body: response.body,
      bodyBuffer: response.bodyBuffer,
      httpVersion: response.httpVersion,
      timing: response.timing,
      backend: "raw",
      raw: response.raw,
    };

    return this.wrapResponse(unified);
  }

  /**
   * Send raw HTTP data directly (maximum control)
   */
  async rawSend(options: {
    host: string;
    port: number;
    protocol?: "http" | "https";
    data: string | Buffer;
    timeout?: number;
    tls?: TLSOptions;
    collectTiming?: boolean;
  }): Promise<HttpClientResponse> {
    const response = await this.rawClient.sendRaw({
      ...options,
      collectTiming: options.collectTiming ?? this.options.collectTiming,
      timeout: options.timeout ?? this.options.defaultTimeout,
      tls: options.tls ?? this.options.defaultTls,
    });

    const unified: UnifiedResponse = {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      statusText: response.statusMessage,
      headers: response.headers,
      body: response.body,
      bodyBuffer: response.bodyBuffer,
      httpVersion: response.httpVersion,
      timing: response.timing,
      backend: "raw",
      raw: response.raw,
    };

    return this.wrapResponse(unified);
  }

  /**
   * Send pipelined HTTP/1.x requests
   */
  async rawPipelined(options: {
    host: string;
    port: number;
    protocol?: "http" | "https";
    requests: (string | RequestBuilder)[];
    timeout?: number;
    tls?: TLSOptions;
    collectTiming?: boolean;
  }): Promise<HttpClientResponse[]> {
    const requests = options.requests.map((r) =>
      r instanceof RequestBuilder ? r.build() : r
    );

    const responses = await this.rawClient.sendPipelined({
      host: options.host,
      port: options.port,
      protocol: options.protocol,
      requests,
      timeout: options.timeout ?? this.options.defaultTimeout,
      tls: options.tls ?? this.options.defaultTls,
      collectTiming: options.collectTiming ?? this.options.collectTiming,
    });

    return responses.map((response) => {
      const unified: UnifiedResponse = {
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        statusText: response.statusMessage,
        headers: response.headers,
        body: response.body,
        bodyBuffer: response.bodyBuffer,
        httpVersion: response.httpVersion,
        timing: response.timing,
        backend: "raw",
        raw: response.raw,
      };
      return this.wrapResponse(unified);
    });
  }

  // ==========================================================================
  // HTTP/2 Requests (Binary Protocol)
  // ==========================================================================

  /**
   * Send an HTTP/2 request
   */
  async http2(
    optionsOrBuilder:
      | {
          host: string;
          port?: number;
          tls?: TLSOptions;
          request: Http2RequestOptions;
          collectTiming?: boolean;
          timeout?: number;
        }
      | RequestBuilder
  ): Promise<HttpClientResponse> {
    let host: string;
    let port: number;
    let tls: TLSOptions | undefined;
    let request: Http2RequestOptions;
    let collectTiming: boolean;
    let timeout: number;

    if (optionsOrBuilder instanceof RequestBuilder) {
      const conn = optionsOrBuilder.getConnectionOptions();
      host = conn.host;
      port = conn.port || 443;
      tls = this.options.defaultTls;
      request = optionsOrBuilder.buildHttp2Request();
      collectTiming = this.options.collectTiming ?? false;
      timeout = this.options.defaultTimeout ?? 30000;
    } else {
      host = optionsOrBuilder.host;
      port = optionsOrBuilder.port ?? 443;
      tls = optionsOrBuilder.tls ?? this.options.defaultTls;
      request = optionsOrBuilder.request;
      collectTiming =
        optionsOrBuilder.collectTiming ?? this.options.collectTiming ?? false;
      timeout =
        optionsOrBuilder.timeout ?? this.options.defaultTimeout ?? 30000;
    }

    const response = await this.http2Client.sendRequest({
      host,
      port,
      tls,
      request,
      collectTiming,
      timeout,
    });

    const unified: UnifiedResponse = {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      statusText: "",
      headers: response.headers,
      body: response.body.toString("utf-8"),
      bodyBuffer: response.body,
      httpVersion: "2",
      timing: response.timing,
      backend: "http2",
      raw: response.rawResponse.raw,
      frames: response.frames,
    };

    return this.wrapResponse(unified);
  }

  /**
   * Send raw HTTP/2 frames
   */
  async http2RawFrames(options: {
    host: string;
    port?: number;
    tls?: TLSOptions;
    frames: Buffer;
    collectTiming?: boolean;
    timeout?: number;
  }): Promise<{
    frames: unknown[];
    rawBuffer: Buffer;
    timing?: TimingMetrics;
  }> {
    return this.http2Client.sendRawFrames({
      host: options.host,
      port: options.port ?? 443,
      tls: options.tls ?? this.options.defaultTls,
      frames: options.frames,
      collectTiming: options.collectTiming ?? this.options.collectTiming,
      timeout: options.timeout ?? this.options.defaultTimeout,
    });
  }

  // ==========================================================================
  // Access to Underlying Clients
  // ==========================================================================

  /**
   * Get the underlying FetchClient for advanced usage
   */
  get fetchClientInstance(): FetchClient {
    return this.fetchClient;
  }

  /**
   * Get the underlying RawHttp client for advanced usage
   */
  get rawClientInstance(): RawHttp {
    return this.rawClient;
  }

  /**
   * Get the underlying Http2Client for advanced usage
   */
  get http2ClientInstance(): Http2Client {
    return this.http2Client;
  }

  /**
   * Get HTTP/2 frame builder for manual frame construction
   */
  get http2Builder() {
    return this.http2Client.builder;
  }

  /**
   * Get HTTP/2 frame parser for manual frame parsing
   */
  get http2Parser() {
    return this.http2Client.parser;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Normalize headers to Record<string, string>
   */
  private normalizeHeaders(
    headers?: Record<string, string | string[]> | Map<string, string | string[]>
  ): Record<string, string> | undefined {
    if (!headers) return undefined;

    const result: Record<string, string> = {};

    if (headers instanceof Map) {
      for (const [key, value] of headers) {
        result[key] = Array.isArray(value) ? value.join(", ") : value;
      }
    } else {
      for (const [key, value] of Object.entries(headers)) {
        result[key] = Array.isArray(value) ? value.join(", ") : value;
      }
    }

    return result;
  }

  /**
   * Wrap response with analyzer
   */
  private wrapResponse(response: UnifiedResponse): HttpClientResponse {
    return {
      ...response,
      analyzer: new UnifiedResponseAnalyzer(response),
    };
  }
}

// Re-export for convenience
export { RequestBuilder } from "./builder";
