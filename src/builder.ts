/**
 * requestr - Request Builder
 * Fluent API for constructing HTTP requests
 */

import type { MalformationType, RequestOptions } from "./types";

export interface FetchInit {
  method: string;
  headers: Headers;
  body?: BodyInit;
}

export interface Http2Headers {
  ":method": string;
  ":path": string;
  ":scheme": string;
  ":authority": string;
  [key: string]: string;
}

export class RequestBuilder {
  private _url: string = "";
  private _method: string = "GET";
  private _path: string = "/";
  private _host: string = "";
  private _port: number = 80;
  private _scheme: "http" | "https" = "http";
  private _httpVersion: string = "1.1";
  private _headers: Array<{ name: string; value: string; raw?: string }> = [];
  private _body: string | Buffer = "";
  private _lineEnding: string = "\r\n";
  private _requestLineSeparator: string = " ";

  /**
   * Set full URL (for fetch-based requests)
   * Automatically extracts host, port, path, and scheme
   */
  url(u: string): this {
    this._url = u;
    try {
      const parsed = new URL(u);
      this._host = parsed.hostname;
      this._port = parsed.port
        ? parseInt(parsed.port, 10)
        : parsed.protocol === "https:"
        ? 443
        : 80;
      this._path = parsed.pathname + parsed.search + parsed.hash;
      this._scheme = parsed.protocol === "https:" ? "https" : "http";
    } catch {
      // Invalid URL, just store as-is
    }
    return this;
  }

  /**
   * Set host (for raw/http2 requests)
   */
  host(h: string): this {
    this._host = h;
    return this;
  }

  /**
   * Set port (for raw/http2 requests)
   */
  port(p: number): this {
    this._port = p;
    return this;
  }

  /**
   * Set scheme (http or https)
   */
  scheme(s: "http" | "https"): this {
    this._scheme = s;
    return this;
  }

  /**
   * Set HTTP method (GET, POST, PUT, DELETE, etc.)
   * Can include malformed methods for testing
   */
  method(m: string): this {
    this._method = m;
    return this;
  }

  /**
   * Set request path/URI
   * Can include malformed paths for testing
   */
  path(p: string): this {
    this._path = p;
    return this;
  }

  /**
   * Set HTTP version (e.g., '1.1', '1.0', '2.0')
   */
  httpVersion(v: string): this {
    this._httpVersion = v;
    return this;
  }

  /**
   * Add a header with standard formatting
   */
  header(name: string, value: string): this {
    this._headers.push({ name, value });
    return this;
  }

  /**
   * Add a raw header line (no formatting applied)
   */
  rawHeader(rawLine: string): this {
    this._headers.push({ name: "", value: "", raw: rawLine });
    return this;
  }

  /**
   * Add multiple headers at once
   */
  headers(h: Record<string, string | string[]>): this {
    for (const [name, value] of Object.entries(h)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          this.header(name, v);
        }
      } else {
        this.header(name, value);
      }
    }
    return this;
  }

  /**
   * Add a duplicate header (same name, different value)
   */
  duplicateHeader(name: string, values: string[]): this {
    for (const value of values) {
      this.header(name, value);
    }
    return this;
  }

  /**
   * Add a malformed header based on malformation type
   */
  malformedHeader(name: string, value: string, type: MalformationType): this {
    let raw: string;
    switch (type) {
      case "space-before-colon":
        raw = `${name} : ${value}`;
        break;
      case "space-after-colon":
        raw = `${name}:  ${value}`;
        break;
      case "tab-separator":
        raw = `${name}:\t${value}`;
        break;
      case "no-space-after-colon":
        raw = `${name}:${value}`;
        break;
      case "double-space":
        raw = `${name}:  ${value}`;
        break;
      case "crlf-injection":
        raw = `${name}: ${value}\r\nInjected: header`;
        break;
      case "null-byte":
        raw = `${name}: ${value}\x00injected`;
        break;
      case "oversized-header":
        raw = `${name}: ${"A".repeat(8192)}${value}`;
        break;
      case "empty-header-name":
        raw = `: ${value}`;
        break;
      case "empty-header-value":
        raw = `${name}: `;
        break;
      default:
        raw = `${name}: ${value}`;
    }
    this._headers.push({ name: "", value: "", raw });
    return this;
  }

  /**
   * Set request body
   */
  body(b: string | Buffer): this {
    this._body = b;
    return this;
  }

  /**
   * Set JSON body with Content-Type header
   */
  jsonBody(obj: unknown): this {
    this._body = JSON.stringify(obj);
    this.header("Content-Type", "application/json");
    return this;
  }

  /**
   * Set custom line ending (default: CRLF)
   */
  lineEnding(ending: string): this {
    this._lineEnding = ending;
    return this;
  }

  /**
   * Use LF only line endings (common malformation test)
   */
  useLfOnly(): this {
    this._lineEnding = "\n";
    return this;
  }

  /**
   * Use CR only line endings (common malformation test)
   */
  useCrOnly(): this {
    this._lineEnding = "\r";
    return this;
  }

  /**
   * Set request line separator (default: single space)
   */
  requestLineSeparator(sep: string): this {
    this._requestLineSeparator = sep;
    return this;
  }

  /**
   * Build the raw HTTP request string
   */
  build(): string {
    const lines: string[] = [];

    // Request line
    lines.push(
      `${this._method}${this._requestLineSeparator}${this._path}${this._requestLineSeparator}HTTP/${this._httpVersion}`
    );

    // Headers
    for (const header of this._headers) {
      if (header.raw !== undefined) {
        lines.push(header.raw);
      } else {
        lines.push(`${header.name}: ${header.value}`);
      }
    }

    // Empty line before body
    lines.push("");

    // Join with line ending
    let request = lines.join(this._lineEnding);

    // Append body
    if (this._body) {
      request +=
        typeof this._body === "string" ? this._body : this._body.toString();
    }

    return request;
  }

  /**
   * Build as Buffer (useful for binary payloads)
   */
  buildBuffer(): Buffer {
    const lines: string[] = [];

    // Request line
    lines.push(
      `${this._method}${this._requestLineSeparator}${this._path}${this._requestLineSeparator}HTTP/${this._httpVersion}`
    );

    // Headers
    for (const header of this._headers) {
      if (header.raw !== undefined) {
        lines.push(header.raw);
      } else {
        lines.push(`${header.name}: ${header.value}`);
      }
    }

    // Empty line before body
    lines.push("");

    // Join with line ending
    const headerPart = Buffer.from(lines.join(this._lineEnding));

    // Append body
    if (this._body) {
      const bodyBuffer =
        typeof this._body === "string" ? Buffer.from(this._body) : this._body;
      return Buffer.concat([headerPart, bodyBuffer]);
    }

    return headerPart;
  }

  /**
   * Clone this builder for variations
   */
  clone(): RequestBuilder {
    const cloned = new RequestBuilder();
    cloned._url = this._url;
    cloned._method = this._method;
    cloned._path = this._path;
    cloned._host = this._host;
    cloned._port = this._port;
    cloned._scheme = this._scheme;
    cloned._httpVersion = this._httpVersion;
    cloned._headers = [...this._headers.map((h) => ({ ...h }))];
    cloned._body = this._body;
    cloned._lineEnding = this._lineEnding;
    cloned._requestLineSeparator = this._requestLineSeparator;
    return cloned;
  }

  // ==========================================================================
  // Build Methods for Different Backends
  // ==========================================================================

  /**
   * Build as RequestOptions (for RawHttp.sendRequest)
   */
  buildOptions(): RequestOptions {
    const headers: Record<string, string | string[]> = {};

    for (const h of this._headers) {
      if (h.raw) continue; // Skip raw headers for options format
      const existing = headers[h.name];
      if (existing) {
        if (Array.isArray(existing)) {
          existing.push(h.value);
        } else {
          headers[h.name] = [existing, h.value];
        }
      } else {
        headers[h.name] = h.value;
      }
    }

    return {
      method: this._method,
      path: this._path,
      headers,
      body: this._body || undefined,
    };
  }

  /**
   * Build as fetch-compatible RequestInit
   * Note: Raw/malformed headers are normalized for fetch compatibility
   */
  buildFetchInit(): FetchInit {
    const headers = new Headers();

    for (const h of this._headers) {
      if (h.raw) {
        // Try to parse raw header
        const colonIdx = h.raw.indexOf(":");
        if (colonIdx > 0) {
          const name = h.raw.substring(0, colonIdx).trim();
          const value = h.raw.substring(colonIdx + 1).trim();
          if (name && value) {
            headers.append(name, value);
          }
        }
      } else {
        headers.append(h.name, h.value);
      }
    }

    const init: FetchInit = {
      method: this._method,
      headers,
    };

    if (this._body) {
      init.body =
        typeof this._body === "string"
          ? this._body
          : new Uint8Array(this._body);
    }

    return init;
  }

  /**
   * Build full URL for fetch requests
   */
  buildUrl(): string {
    if (this._url) {
      return this._url;
    }

    if (this._host) {
      const port =
        (this._scheme === "https" && this._port === 443) ||
        (this._scheme === "http" && this._port === 80)
          ? ""
          : `:${this._port}`;
      return `${this._scheme}://${this._host}${port}${this._path}`;
    }

    return this._path;
  }

  /**
   * Build as HTTP/2 headers map (pseudo-headers + regular headers)
   */
  buildHttp2Headers(): Map<string, string> {
    const headers = new Map<string, string>();

    // Pseudo-headers (must come first in HTTP/2)
    headers.set(":method", this._method);
    headers.set(":path", this._path);
    headers.set(":scheme", this._scheme);
    headers.set(":authority", this._host || this.getHostHeader() || "");

    // Regular headers
    for (const h of this._headers) {
      if (h.raw) {
        const colonIdx = h.raw.indexOf(":");
        if (colonIdx > 0) {
          const name = h.raw.substring(0, colonIdx).trim().toLowerCase();
          const value = h.raw.substring(colonIdx + 1).trim();
          if (name && !name.startsWith(":")) {
            headers.set(name, value);
          }
        }
      } else if (h.name.toLowerCase() !== "host") {
        // Skip Host header for HTTP/2 (use :authority instead)
        headers.set(h.name.toLowerCase(), h.value);
      }
    }

    return headers;
  }

  /**
   * Build as Http2RequestOptions
   */
  buildHttp2Request(): {
    method: string;
    path: string;
    authority: string;
    scheme: "http" | "https";
    headers: Record<string, string>;
    body?: string | Buffer;
  } {
    const headers: Record<string, string> = {};

    for (const h of this._headers) {
      if (h.raw) {
        const colonIdx = h.raw.indexOf(":");
        if (colonIdx > 0) {
          const name = h.raw.substring(0, colonIdx).trim().toLowerCase();
          const value = h.raw.substring(colonIdx + 1).trim();
          if (name && !name.startsWith(":") && name !== "host") {
            headers[name] = value;
          }
        }
      } else if (h.name.toLowerCase() !== "host") {
        headers[h.name.toLowerCase()] = h.value;
      }
    }

    return {
      method: this._method,
      path: this._path,
      authority: this._host || this.getHostHeader() || "",
      scheme: this._scheme,
      headers,
      body: this._body || undefined,
    };
  }

  /**
   * Get connection options for raw requests
   */
  getConnectionOptions(): {
    host: string;
    port: number;
    protocol: "http" | "https";
  } {
    return {
      host: this._host || this.getHostHeader() || "",
      port: this._port,
      protocol: this._scheme,
    };
  }

  /**
   * Extract host from headers if set
   */
  private getHostHeader(): string | undefined {
    const hostHeader = this._headers.find(
      (h) => h.name.toLowerCase() === "host"
    );
    if (hostHeader) {
      // Remove port if present
      return hostHeader.value.split(":")[0];
    }
    return undefined;
  }
}
