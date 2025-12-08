/**
 * httpforger - Response Parser and Analyzer
 */

import type { RawResponse } from "./types";

// ============================================================================
// Response Parser
// ============================================================================

export class ResponseParser {
  /**
   * Parse raw HTTP response into structured format
   * Handles malformed responses gracefully
   */
  static parse(raw: Buffer): RawResponse {
    const rawString = raw.toString("utf-8");
    const response: RawResponse = {
      raw: rawString,
      rawBuffer: raw,
      statusCode: 0,
      statusMessage: "",
      httpVersion: "",
      headers: new Map(),
      body: "",
      bodyBuffer: Buffer.alloc(0),
    };

    try {
      // Find header/body separator (CRLF CRLF or LF LF)
      let headerEndIndex = rawString.indexOf("\r\n\r\n");
      let separatorLength = 4;

      if (headerEndIndex === -1) {
        headerEndIndex = rawString.indexOf("\n\n");
        separatorLength = 2;
      }

      if (headerEndIndex === -1) {
        // No body separator found, treat entire response as headers
        headerEndIndex = rawString.length;
        separatorLength = 0;
      }

      const headerSection = rawString.substring(0, headerEndIndex);
      const bodyStart = headerEndIndex + separatorLength;

      // Extract body
      response.body = rawString.substring(bodyStart);
      response.bodyBuffer = raw.subarray(bodyStart);

      // Parse status line
      const lines = headerSection.split(/\r?\n/);
      const statusLine = lines[0] || "";
      const statusMatch = statusLine.match(
        /^HTTP\/(\d+\.?\d*)\s+(\d+)\s*(.*)?$/i
      );

      if (statusMatch && statusMatch[1] && statusMatch[2]) {
        response.httpVersion = statusMatch[1];
        response.statusCode = parseInt(statusMatch[2], 10);
        response.statusMessage = statusMatch[3] || "";
      } else {
        response.parseError = `Invalid status line: ${statusLine}`;
      }

      // Parse headers (handle duplicates by storing as array)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        const colonIndex = line.indexOf(":");

        if (colonIndex > 0) {
          const name = line.substring(0, colonIndex).trim().toLowerCase();
          const value = line.substring(colonIndex + 1).trim();

          const existing = response.headers.get(name);
          if (existing) {
            existing.push(value);
          } else {
            response.headers.set(name, [value]);
          }
        }
      }
    } catch (error) {
      response.parseError = `Parse error: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    return response;
  }
}

// ============================================================================
// Response Analyzer
// ============================================================================

export class ResponseAnalyzer {
  constructor(private response: RawResponse) {}

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
   * Check if raw response contains a string (includes headers)
   */
  rawContains(search: string, caseSensitive = true): boolean {
    if (caseSensitive) {
      return this.response.raw.includes(search);
    }
    return this.response.raw.toLowerCase().includes(search.toLowerCase());
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
    return this.response.statusCode === code;
  }

  /**
   * Check if status is in range (e.g., 200-299 for success)
   */
  hasStatusInRange(min: number, max: number): boolean {
    return this.response.statusCode >= min && this.response.statusCode <= max;
  }

  /**
   * Check if response indicates success (2xx)
   */
  isSuccess(): boolean {
    return this.hasStatusInRange(200, 299);
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
   * Check for potential HTTP smuggling indicators
   */
  checkSmugglingIndicators(): {
    hasContentLength: boolean;
    hasTransferEncoding: boolean;
    hasBothCLTE: boolean;
    contentLengthCount: number;
    transferEncodingCount: number;
  } {
    const clValues = this.response.headers.get("content-length") || [];
    const teValues = this.response.headers.get("transfer-encoding") || [];

    return {
      hasContentLength: clValues.length > 0,
      hasTransferEncoding: teValues.length > 0,
      hasBothCLTE: clValues.length > 0 && teValues.length > 0,
      contentLengthCount: clValues.length,
      transferEncodingCount: teValues.length,
    };
  }

  /**
   * Extract all cookies from Set-Cookie headers
   */
  getCookies(): string[] {
    return this.response.headers.get("set-cookie") || [];
  }

  /**
   * Get the raw response for manual analysis
   */
  getRaw(): string {
    return this.response.raw;
  }

  /**
   * Get the raw response as buffer
   */
  getRawBuffer(): Buffer {
    return this.response.rawBuffer;
  }
}
