/**
 * requestr - Main RawHttp Client Class
 */

import type {
  RequestOptions,
  TLSOptions,
  TimingMetrics,
  RawResponse,
  ProxyOptions,
  SendOptions,
} from "./types";
import { RequestBuilder } from "./builder";
import { ResponseParser, ResponseAnalyzer } from "./response";

export class RawHttp {
  private defaultTimeout: number = 30000;

  constructor(options?: { defaultTimeout?: number }) {
    if (options?.defaultTimeout) {
      this.defaultTimeout = options.defaultTimeout;
    }
  }

  /**
   * Create a new RequestBuilder instance
   */
  static request(): RequestBuilder {
    return new RequestBuilder();
  }

  /**
   * Send a raw HTTP request
   */
  async sendRequest(
    options: SendOptions
  ): Promise<RawResponse & { analyzer: ResponseAnalyzer }> {
    const {
      host,
      port,
      protocol = "http",
      timeout = this.defaultTimeout,
      tls,
      request,
      proxy,
      keepAlive,
      collectTiming = false,
    } = options;

    // Convert request to string if it's a RequestOptions object
    let rawRequest: string;
    if (typeof request === "string") {
      rawRequest = request;
    } else {
      rawRequest = this.buildRequestFromOptions(request, host, port, keepAlive);
    }

    const response = await this.sendRaw({
      host,
      port,
      protocol,
      timeout,
      tls,
      data: rawRequest,
      proxy,
      collectTiming,
    });

    return {
      ...response,
      analyzer: new ResponseAnalyzer(response),
    };
  }

  /**
   * Send multiple requests over a single connection (HTTP pipelining)
   */
  async sendPipelined(options: {
    host: string;
    port: number;
    protocol?: "http" | "https";
    timeout?: number;
    tls?: TLSOptions;
    requests: (RequestOptions | string)[];
    collectTiming?: boolean;
  }): Promise<RawResponse[]> {
    const {
      host,
      port,
      protocol = "http",
      timeout = this.defaultTimeout,
      tls,
      requests,
      collectTiming = false,
    } = options;

    // Build all requests into a single buffer
    let pipelinedData = "";
    for (const req of requests) {
      if (typeof req === "string") {
        pipelinedData += req;
      } else {
        pipelinedData += this.buildRequestFromOptions(req, host, port, true);
      }
    }

    // Send all requests at once
    const rawResponse = await this.sendRawWithMultiResponse({
      host,
      port,
      protocol,
      timeout,
      tls,
      data: pipelinedData,
      expectedResponses: requests.length,
      collectTiming,
    });

    return rawResponse;
  }

  /**
   * Send raw data and expect multiple responses (for pipelining)
   */
  private async sendRawWithMultiResponse(options: {
    host: string;
    port: number;
    protocol?: "http" | "https";
    timeout?: number;
    tls?: TLSOptions;
    data: string | Buffer;
    expectedResponses: number;
    collectTiming?: boolean;
  }): Promise<RawResponse[]> {
    const {
      host,
      port,
      protocol = "http",
      timeout = this.defaultTimeout,
      tls,
      data,
      expectedResponses,
      collectTiming = false,
    } = options;

    return new Promise((resolve, reject) => {
      let socket: ReturnType<typeof Bun.connect> extends Promise<infer T>
        ? T
        : never;
      let responseData = Buffer.alloc(0);
      let resolved = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const timing: TimingMetrics = { startTime: Date.now() };

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        if (socket) {
          try {
            socket.end();
          } catch {
            // Ignore cleanup errors
          }
        }
      };

      const parseMultipleResponses = (buffer: Buffer): RawResponse[] => {
        const responses: RawResponse[] = [];
        let remaining = buffer.toString("utf-8");

        for (let i = 0; i < expectedResponses && remaining.length > 0; i++) {
          // Find the end of headers
          let headerEnd = remaining.indexOf("\r\n\r\n");
          let sepLen = 4;
          if (headerEnd === -1) {
            headerEnd = remaining.indexOf("\n\n");
            sepLen = 2;
          }

          if (headerEnd === -1) {
            // Parse whatever is left as the final response
            const resp = ResponseParser.parse(Buffer.from(remaining));
            if (collectTiming) resp.timing = { ...timing };
            responses.push(resp);
            break;
          }

          const headerSection = remaining.substring(0, headerEnd);

          // Try to determine body length
          const clMatch = headerSection.match(/content-length:\s*(\d+)/i);
          const teMatch = headerSection.match(/transfer-encoding:\s*chunked/i);

          let bodyEnd: number;

          if (clMatch && clMatch[1]) {
            const contentLength = parseInt(clMatch[1], 10);
            bodyEnd = headerEnd + sepLen + contentLength;
          } else if (teMatch) {
            // Find chunked terminator
            const chunkedEnd = remaining.indexOf("0\r\n\r\n", headerEnd);
            if (chunkedEnd !== -1) {
              bodyEnd = chunkedEnd + 5;
            } else {
              bodyEnd = remaining.length;
            }
          } else {
            // No body indicator, assume no body
            bodyEnd = headerEnd + sepLen;
          }

          const responseStr = remaining.substring(0, bodyEnd);
          const resp = ResponseParser.parse(Buffer.from(responseStr));
          if (collectTiming) resp.timing = { ...timing };
          responses.push(resp);

          remaining = remaining.substring(bodyEnd);
        }

        return responses;
      };

      const resolveOnce = (responses: RawResponse[]) => {
        if (!resolved) {
          resolved = true;
          if (collectTiming) {
            timing.endTime = Date.now();
            timing.totalDuration = timing.endTime - timing.startTime;
          }
          cleanup();
          resolve(responses);
        }
      };

      const rejectOnce = (error: Error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(error);
        }
      };

      timeoutId = setTimeout(() => {
        rejectOnce(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);

      const socketConfig = {
        hostname: host,
        port,
        socket: {
          open(sock: typeof socket) {
            socket = sock;
            if (collectTiming) timing.connectTime = Date.now();
            sock.write(data);
          },
          data(_sock: typeof socket, chunk: Buffer) {
            if (collectTiming && !timing.firstByteTime) {
              timing.firstByteTime = Date.now();
              timing.ttfb = timing.firstByteTime - timing.startTime;
            }
            responseData = Buffer.concat([responseData, chunk]);
          },
          close() {
            resolveOnce(parseMultipleResponses(responseData));
          },
          error(_sock: typeof socket, error: Error) {
            rejectOnce(new Error(`Socket error: ${error.message}`));
          },
          end() {
            resolveOnce(parseMultipleResponses(responseData));
          },
          connectError(_sock: typeof socket, error: Error) {
            rejectOnce(new Error(`Connection error: ${error.message}`));
          },
        },
      };

      if (protocol === "https") {
        Bun.connect({
          ...socketConfig,
          tls: {
            rejectUnauthorized: tls?.rejectUnauthorized ?? false,
            serverName: tls?.servername ?? host,
            ...tls,
          } as Parameters<typeof Bun.connect>[0]["tls"],
        }).catch(rejectOnce);
      } else {
        Bun.connect(socketConfig).catch(rejectOnce);
      }
    });
  }

  /**
   * Send raw data over TCP/TLS connection
   */
  async sendRaw(options: {
    host: string;
    port: number;
    protocol?: "http" | "https";
    timeout?: number;
    tls?: TLSOptions;
    data: string | Buffer;
    proxy?: ProxyOptions;
    collectTiming?: boolean;
  }): Promise<RawResponse> {
    const {
      host,
      port,
      protocol = "http",
      timeout = this.defaultTimeout,
      tls,
      data,
      proxy,
      collectTiming = false,
    } = options;

    // If proxy is specified, route through proxy
    if (proxy) {
      return this.sendViaProxy({
        host,
        port,
        protocol,
        timeout,
        tls,
        data,
        proxy,
        collectTiming,
      });
    }

    return new Promise((resolve, reject) => {
      let socket: ReturnType<typeof Bun.connect> extends Promise<infer T>
        ? T
        : never;
      let responseData = Buffer.alloc(0);
      let resolved = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const timing: TimingMetrics = { startTime: Date.now() };

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        if (socket) {
          try {
            socket.end();
          } catch {
            // Ignore cleanup errors
          }
        }
      };

      const resolveOnce = (response: RawResponse) => {
        if (!resolved) {
          resolved = true;
          if (collectTiming) {
            timing.endTime = Date.now();
            timing.totalDuration = timing.endTime - timing.startTime;
            if (timing.connectTime) {
              timing.connectionDuration = timing.connectTime - timing.startTime;
            }
            response.timing = timing;
          }
          cleanup();
          resolve(response);
        }
      };

      const rejectOnce = (error: Error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(error);
        }
      };

      // Set timeout
      timeoutId = setTimeout(() => {
        rejectOnce(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);

      const socketConfig = {
        hostname: host,
        port,
        socket: {
          open(sock: typeof socket) {
            socket = sock;
            if (collectTiming) timing.connectTime = Date.now();
            const dataToSend = typeof data === "string" ? data : data;
            sock.write(dataToSend);
          },
          data(_sock: typeof socket, chunk: Buffer) {
            if (collectTiming && !timing.firstByteTime) {
              timing.firstByteTime = Date.now();
              timing.ttfb = timing.firstByteTime - timing.startTime;
            }
            responseData = Buffer.concat([responseData, chunk]);
          },
          close() {
            const response = ResponseParser.parse(responseData);
            resolveOnce(response);
          },
          error(_sock: typeof socket, error: Error) {
            rejectOnce(new Error(`Socket error: ${error.message}`));
          },
          end() {
            const response = ResponseParser.parse(responseData);
            resolveOnce(response);
          },
          connectError(_sock: typeof socket, error: Error) {
            rejectOnce(new Error(`Connection error: ${error.message}`));
          },
        },
      };

      if (protocol === "https") {
        Bun.connect({
          ...socketConfig,
          tls: {
            rejectUnauthorized: tls?.rejectUnauthorized ?? false,
            serverName: tls?.servername ?? host,
            ...tls,
          } as Parameters<typeof Bun.connect>[0]["tls"],
        }).catch(rejectOnce);
      } else {
        Bun.connect(socketConfig).catch(rejectOnce);
      }
    });
  }

  /**
   * Send request through HTTP proxy using CONNECT method
   */
  private async sendViaProxy(options: {
    host: string;
    port: number;
    protocol?: "http" | "https";
    timeout?: number;
    tls?: TLSOptions;
    data: string | Buffer;
    proxy: ProxyOptions;
    collectTiming?: boolean;
  }): Promise<RawResponse> {
    const { protocol, proxy } = options;

    // For HTTP proxy, we use CONNECT for HTTPS targets
    if (protocol === "https" || proxy.protocol === "http") {
      return this.sendViaHttpProxy(options);
    }

    // SOCKS proxy support would require additional implementation
    if (proxy.protocol === "socks4" || proxy.protocol === "socks5") {
      throw new Error(
        "SOCKS proxy support not yet implemented. Use HTTP proxy or direct connection."
      );
    }

    return this.sendViaHttpProxy(options);
  }

  /**
   * Send request through HTTP CONNECT proxy
   */
  private async sendViaHttpProxy(options: {
    host: string;
    port: number;
    protocol?: "http" | "https";
    timeout?: number;
    tls?: TLSOptions;
    data: string | Buffer;
    proxy: ProxyOptions;
    collectTiming?: boolean;
  }): Promise<RawResponse> {
    const {
      host,
      port,
      protocol = "http",
      timeout = this.defaultTimeout,
      tls,
      data,
      proxy,
      collectTiming = false,
    } = options;

    return new Promise((resolve, reject) => {
      let socket: ReturnType<typeof Bun.connect> extends Promise<infer T>
        ? T
        : never;
      let responseData = Buffer.alloc(0);
      let resolved = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let tunnelEstablished = false;

      const timing: TimingMetrics = { startTime: Date.now() };

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        if (socket) {
          try {
            socket.end();
          } catch {
            // Ignore cleanup errors
          }
        }
      };

      const resolveOnce = (response: RawResponse) => {
        if (!resolved) {
          resolved = true;
          if (collectTiming) {
            timing.endTime = Date.now();
            timing.totalDuration = timing.endTime - timing.startTime;
            response.timing = timing;
          }
          cleanup();
          resolve(response);
        }
      };

      const rejectOnce = (error: Error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(error);
        }
      };

      timeoutId = setTimeout(() => {
        rejectOnce(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);

      // Build CONNECT request
      let connectRequest = `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n`;
      if (proxy.auth) {
        const auth = Buffer.from(
          `${proxy.auth.username}:${proxy.auth.password}`
        ).toString("base64");
        connectRequest += `Proxy-Authorization: Basic ${auth}\r\n`;
      }
      connectRequest += "\r\n";

      const socketConfig = {
        hostname: proxy.host,
        port: proxy.port,
        socket: {
          open(sock: typeof socket) {
            socket = sock;
            if (collectTiming) timing.connectTime = Date.now();
            // Send CONNECT request to establish tunnel
            sock.write(connectRequest);
          },
          data(_sock: typeof socket, chunk: Buffer) {
            if (!tunnelEstablished) {
              // Check for successful CONNECT response
              const response = chunk.toString();
              if (response.includes("200")) {
                tunnelEstablished = true;
                // Now send the actual request through the tunnel
                // For HTTPS, we'd need to upgrade to TLS here
                // For now, just send the data
                if (protocol === "https" && tls) {
                  // Note: Bun doesn't support upgrading existing socket to TLS easily
                  // This is a limitation - for full HTTPS proxy support, we'd need different approach
                  rejectOnce(
                    new Error(
                      "HTTPS through HTTP proxy requires TLS upgrade which is not fully supported. Consider using direct connection."
                    )
                  );
                  return;
                }
                socket.write(data);
              } else if (response.includes("407")) {
                rejectOnce(new Error("Proxy authentication required"));
              } else {
                rejectOnce(
                  new Error(
                    `Proxy CONNECT failed: ${response.split("\r\n")[0]}`
                  )
                );
              }
            } else {
              if (collectTiming && !timing.firstByteTime) {
                timing.firstByteTime = Date.now();
                timing.ttfb = timing.firstByteTime - timing.startTime;
              }
              responseData = Buffer.concat([responseData, chunk]);
            }
          },
          close() {
            if (tunnelEstablished) {
              const response = ResponseParser.parse(responseData);
              resolveOnce(response);
            }
          },
          error(_sock: typeof socket, error: Error) {
            rejectOnce(new Error(`Proxy socket error: ${error.message}`));
          },
          end() {
            if (tunnelEstablished) {
              const response = ResponseParser.parse(responseData);
              resolveOnce(response);
            }
          },
          connectError(_sock: typeof socket, error: Error) {
            rejectOnce(new Error(`Proxy connection error: ${error.message}`));
          },
        },
      };

      Bun.connect(socketConfig).catch(rejectOnce);
    });
  }

  /**
   * Build HTTP request string from RequestOptions
   */
  private buildRequestFromOptions(
    options: RequestOptions,
    host: string,
    port: number,
    keepAlive?: boolean
  ): string {
    const builder = new RequestBuilder()
      .method(options.method || "GET")
      .path(options.path || "/");

    // Add Host header if not present
    let hasHost = false;
    let hasConnection = false;

    if (options.headers) {
      const headers =
        options.headers instanceof Map
          ? Object.fromEntries(options.headers)
          : options.headers;

      for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() === "host") hasHost = true;
        if (name.toLowerCase() === "connection") hasConnection = true;
        if (Array.isArray(value)) {
          for (const v of value) {
            builder.header(name, v);
          }
        } else {
          builder.header(name, value);
        }
      }
    }

    if (!hasHost) {
      const hostValue = port === 80 || port === 443 ? host : `${host}:${port}`;
      builder.header("Host", hostValue);
    }

    if (!hasConnection && keepAlive !== undefined) {
      builder.header("Connection", keepAlive ? "keep-alive" : "close");
    }

    if (options.body) {
      builder.body(options.body);
      const bodyLength =
        typeof options.body === "string"
          ? Buffer.byteLength(options.body)
          : options.body.length;
      builder.header("Content-Length", bodyLength.toString());
    }

    return builder.build();
  }

  // ============================================================================
  // Malformation Helper Methods (Static)
  // ============================================================================

  /**
   * Create a request with HTTP request smuggling CL.TE payload
   */
  static smugglingCLTE(options: {
    host: string;
    path?: string;
    contentLength: number;
    body: string;
  }): string {
    return new RequestBuilder()
      .method("POST")
      .path(options.path || "/")
      .header("Host", options.host)
      .header("Content-Length", options.contentLength.toString())
      .header("Transfer-Encoding", "chunked")
      .body(options.body)
      .build();
  }

  /**
   * Create a request with HTTP request smuggling TE.CL payload
   */
  static smugglingTECL(options: {
    host: string;
    path?: string;
    contentLength: number;
    body: string;
  }): string {
    return new RequestBuilder()
      .method("POST")
      .path(options.path || "/")
      .header("Host", options.host)
      .header("Transfer-Encoding", "chunked")
      .header("Content-Length", options.contentLength.toString())
      .body(options.body)
      .build();
  }

  /**
   * Create a request with obfuscated Transfer-Encoding header
   */
  static obfuscatedTransferEncoding(options: {
    host: string;
    path?: string;
    obfuscation: "space" | "tab" | "case" | "null" | "vertical-tab" | "newline";
    body: string;
  }): string {
    const builder = new RequestBuilder()
      .method("POST")
      .path(options.path || "/")
      .header("Host", options.host);

    let teValue: string;
    switch (options.obfuscation) {
      case "space":
        teValue = " chunked";
        break;
      case "tab":
        teValue = "\tchunked";
        break;
      case "case":
        teValue = "cHuNkEd";
        break;
      case "null":
        teValue = "chunked\x00";
        break;
      case "vertical-tab":
        teValue = "\x0bchunked";
        break;
      case "newline":
        teValue = "chunked\n ";
        break;
      default:
        teValue = "chunked";
    }

    builder.rawHeader(`Transfer-Encoding: ${teValue}`);
    builder.body(options.body);

    return builder.build();
  }

  /**
   * Create a request with CRLF injection in header
   */
  static crlfInjection(options: {
    host: string;
    path?: string;
    headerName: string;
    headerValue: string;
    injectedHeaders: string;
  }): string {
    return new RequestBuilder()
      .method("GET")
      .path(options.path || "/")
      .header("Host", options.host)
      .rawHeader(
        `${options.headerName}: ${options.headerValue}\r\n${options.injectedHeaders}`
      )
      .build();
  }

  /**
   * Create a request with duplicate headers
   */
  static duplicateHeaders(options: {
    host: string;
    path?: string;
    headerName: string;
    values: string[];
  }): string {
    const builder = new RequestBuilder()
      .method("GET")
      .path(options.path || "/")
      .header("Host", options.host);

    for (const value of options.values) {
      builder.header(options.headerName, value);
    }

    return builder.build();
  }

  /**
   * Create a request with oversized header
   */
  static oversizedHeader(options: {
    host: string;
    path?: string;
    headerName: string;
    size: number;
  }): string {
    return new RequestBuilder()
      .method("GET")
      .path(options.path || "/")
      .header("Host", options.host)
      .header(options.headerName, "A".repeat(options.size))
      .build();
  }

  /**
   * Create a request with null byte injection
   */
  static nullByteInjection(options: {
    host: string;
    path?: string;
    inPath?: boolean;
    inHeader?: { name: string; value: string };
  }): string {
    const builder = new RequestBuilder()
      .method("GET")
      .header("Host", options.host);

    if (options.inPath) {
      builder.path((options.path || "/") + "\x00.txt");
    } else {
      builder.path(options.path || "/");
    }

    if (options.inHeader) {
      builder.rawHeader(
        `${options.inHeader.name}: ${options.inHeader.value}\x00injected`
      );
    }

    return builder.build();
  }

  /**
   * Create a request with HTTP method override attempt
   */
  static methodOverride(options: {
    host: string;
    path?: string;
    actualMethod: string;
    overrideMethod: string;
    overrideHeader?: string;
  }): string {
    const overrideHeaderName =
      options.overrideHeader || "X-HTTP-Method-Override";

    return new RequestBuilder()
      .method(options.actualMethod)
      .path(options.path || "/")
      .header("Host", options.host)
      .header(overrideHeaderName, options.overrideMethod)
      .header("X-HTTP-Method", options.overrideMethod)
      .header("X-Method-Override", options.overrideMethod)
      .build();
  }

  /**
   * Create a request with absolute URI in request line
   */
  static absoluteURI(options: {
    host: string;
    port?: number;
    path?: string;
    protocol?: "http" | "https";
  }): string {
    const port = options.port || 80;
    const protocol = options.protocol || "http";
    const path = options.path || "/";
    const portSuffix =
      (protocol === "http" && port === 80) ||
      (protocol === "https" && port === 443)
        ? ""
        : `:${port}`;

    return new RequestBuilder()
      .method("GET")
      .path(`${protocol}://${options.host}${portSuffix}${path}`)
      .header("Host", options.host)
      .build();
  }

  /**
   * Create a request testing host header attacks
   */
  static hostHeaderAttack(options: {
    legitimateHost: string;
    attackHost: string;
    path?: string;
    attackType:
      | "duplicate"
      | "override"
      | "absolute-url"
      | "port-injection"
      | "subdomain";
  }): string {
    const builder = new RequestBuilder()
      .method("GET")
      .path(options.path || "/");

    switch (options.attackType) {
      case "duplicate":
        builder.header("Host", options.legitimateHost);
        builder.header("Host", options.attackHost);
        break;
      case "override":
        builder.header("Host", options.legitimateHost);
        builder.header("X-Forwarded-Host", options.attackHost);
        builder.header("X-Host", options.attackHost);
        builder.header("X-Original-Host", options.attackHost);
        builder.header("Forwarded", `host=${options.attackHost}`);
        break;
      case "port-injection":
        builder.header(
          "Host",
          `${options.legitimateHost}:${options.attackHost}`
        );
        break;
      case "subdomain":
        builder.header(
          "Host",
          `${options.attackHost}.${options.legitimateHost}`
        );
        break;
      default:
        builder.header("Host", options.legitimateHost);
    }

    return builder.build();
  }

  /**
   * Create a request with HTTP/0.9 style (no headers)
   */
  static http09Request(path: string): string {
    return `GET ${path}\r\n`;
  }

  /**
   * Create a chunked body with optional smuggling
   */
  static createChunkedBody(
    chunks: Array<{ size?: number; data: string; malformed?: boolean }>
  ): string {
    let body = "";

    for (const chunk of chunks) {
      const size = chunk.size ?? Buffer.byteLength(chunk.data);
      if (chunk.malformed) {
        // Malformed chunk size (e.g., with extra characters)
        body += `${size.toString(16)}; extension=value\r\n`;
      } else {
        body += `${size.toString(16)}\r\n`;
      }
      body += `${chunk.data}\r\n`;
    }

    // Terminating chunk
    body += "0\r\n\r\n";

    return body;
  }
}
