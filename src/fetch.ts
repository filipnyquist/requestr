/**
 * httpforger - Fetch Wrapper
 * Provides a fetch-based HTTP client with timing support and RequestBuilder integration
 */

import type {
  FetchRequestOptions,
  UnifiedResponse,
  TimingMetrics,
} from "./types";

export interface FetchResponse extends UnifiedResponse {
  backend: "fetch";
  fetchResponse: Response;
}

/**
 * Fetch-based HTTP client wrapper
 * Uses Bun's native fetch for standards-compliant HTTP requests
 */
export class FetchClient {
  private defaultTimeout: number;
  private defaultCollectTiming: boolean;

  constructor(options?: { defaultTimeout?: number; collectTiming?: boolean }) {
    this.defaultTimeout = options?.defaultTimeout ?? 30000;
    this.defaultCollectTiming = options?.collectTiming ?? false;
  }

  /**
   * Send a fetch request using URL string
   */
  async get(
    url: string,
    options?: Omit<FetchRequestOptions, "url" | "method">
  ): Promise<FetchResponse> {
    return this.request({ ...options, url, method: "GET" });
  }

  /**
   * Send a POST request
   */
  async post(
    url: string,
    body?: BodyInit | null,
    options?: Omit<FetchRequestOptions, "url" | "method" | "body">
  ): Promise<FetchResponse> {
    return this.request({ ...options, url, method: "POST", body });
  }

  /**
   * Send a PUT request
   */
  async put(
    url: string,
    body?: BodyInit | null,
    options?: Omit<FetchRequestOptions, "url" | "method" | "body">
  ): Promise<FetchResponse> {
    return this.request({ ...options, url, method: "PUT", body });
  }

  /**
   * Send a DELETE request
   */
  async delete(
    url: string,
    options?: Omit<FetchRequestOptions, "url" | "method">
  ): Promise<FetchResponse> {
    return this.request({ ...options, url, method: "DELETE" });
  }

  /**
   * Send a PATCH request
   */
  async patch(
    url: string,
    body?: BodyInit | null,
    options?: Omit<FetchRequestOptions, "url" | "method" | "body">
  ): Promise<FetchResponse> {
    return this.request({ ...options, url, method: "PATCH", body });
  }

  /**
   * Send a HEAD request
   */
  async head(
    url: string,
    options?: Omit<FetchRequestOptions, "url" | "method">
  ): Promise<FetchResponse> {
    return this.request({ ...options, url, method: "HEAD" });
  }

  /**
   * Send a custom request
   */
  async request(
    options: FetchRequestOptions & { url: string }
  ): Promise<FetchResponse> {
    const {
      url,
      method = "GET",
      headers,
      body,
      redirect,
      signal,
      credentials,
      cache,
      mode,
      referrer,
      referrerPolicy,
      integrity,
      keepalive,
      collectTiming = this.defaultCollectTiming,
      timeout = this.defaultTimeout,
    } = options;

    const timing: TimingMetrics = { startTime: performance.now() };

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Combine signals if user provided one
    const combinedSignal = signal
      ? this.combineSignals(signal, controller.signal)
      : controller.signal;

    try {
      // Build fetch options
      const fetchOptions: RequestInit = {
        method,
        headers,
        body,
        redirect,
        signal: combinedSignal,
        credentials,
        cache,
        mode,
        referrer,
        referrerPolicy,
        integrity,
        keepalive,
      };

      // Remove undefined values
      Object.keys(fetchOptions).forEach((key) => {
        if (fetchOptions[key as keyof RequestInit] === undefined) {
          delete fetchOptions[key as keyof RequestInit];
        }
      });

      if (collectTiming) {
        timing.connectTime = performance.now();
      }

      const response = await fetch(url, fetchOptions);

      if (collectTiming) {
        timing.firstByteTime = performance.now();
        timing.ttfb = timing.firstByteTime - timing.startTime;
      }

      // Read body
      const bodyBuffer = Buffer.from(await response.arrayBuffer());
      const bodyText = bodyBuffer.toString("utf-8");

      if (collectTiming) {
        timing.endTime = performance.now();
        timing.totalDuration = timing.endTime - timing.startTime;
      }

      // Convert headers to Map<string, string[]>
      const headersMap = new Map<string, string[]>();
      response.headers.forEach((value, key) => {
        const existing = headersMap.get(key.toLowerCase());
        if (existing) {
          existing.push(value);
        } else {
          headersMap.set(key.toLowerCase(), [value]);
        }
      });

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: headersMap,
        body: bodyText,
        bodyBuffer,
        httpVersion: "1.1", // fetch doesn't expose HTTP version
        timing: collectTiming ? timing : undefined,
        backend: "fetch",
        fetchResponse: response,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Send a request using a Request object
   */
  async sendRequest(
    request: Request,
    options?: { collectTiming?: boolean; timeout?: number }
  ): Promise<FetchResponse> {
    const url = request.url;
    const method = request.method;
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return this.request({
      url,
      method,
      headers,
      body: request.body,
      redirect: request.redirect,
      credentials: request.credentials,
      cache: request.cache,
      mode: request.mode,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      integrity: request.integrity,
      keepalive: request.keepalive,
      collectTiming: options?.collectTiming ?? this.defaultCollectTiming,
      timeout: options?.timeout ?? this.defaultTimeout,
    });
  }

  /**
   * Helper to combine multiple abort signals
   */
  private combineSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();

    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort();
        break;
      }
      signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }

    return controller.signal;
  }
}

/**
 * Convenience function for one-off fetch requests
 */
export async function fetchRequest(
  url: string,
  options?: FetchRequestOptions
): Promise<FetchResponse> {
  const client = new FetchClient();
  return client.request({ ...options, url });
}
