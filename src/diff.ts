/**
 * requestr - Diff Utilities for Request/Response Comparison
 */

import type {
  RawResponse,
  DiffResult,
  RequestDiff,
  ResponseDiff,
} from "./types";

export class Diff {
  /**
   * Compare two raw HTTP request strings
   */
  static compareRequests(request1: string, request2: string): RequestDiff {
    const parsed1 = this.parseRequest(request1);
    const parsed2 = this.parseRequest(request2);

    const diff: RequestDiff = {
      method: this.compareField("method", parsed1.method, parsed2.method),
      path: this.compareField("path", parsed1.path, parsed2.path),
      httpVersion: this.compareField(
        "httpVersion",
        parsed1.httpVersion,
        parsed2.httpVersion
      ),
      headers: this.compareHeaders(parsed1.headers, parsed2.headers),
      body: this.compareField("body", parsed1.body, parsed2.body),
      raw: this.generateUnifiedDiff(request1, request2),
    };

    return diff;
  }

  /**
   * Compare two HTTP responses
   */
  static compareResponses(
    response1: RawResponse,
    response2: RawResponse
  ): ResponseDiff {
    const diff: ResponseDiff = {
      statusCode: this.compareField(
        "statusCode",
        String(response1.statusCode),
        String(response2.statusCode)
      ),
      statusMessage: this.compareField(
        "statusMessage",
        response1.statusMessage,
        response2.statusMessage
      ),
      httpVersion: this.compareField(
        "httpVersion",
        response1.httpVersion,
        response2.httpVersion
      ),
      headers: this.compareResponseHeaders(
        response1.headers,
        response2.headers
      ),
      body: this.compareField("body", response1.body, response2.body),
    };

    // Compare timing if available
    if (response1.timing && response2.timing) {
      diff.timing = {};
      if (
        response1.timing.ttfb !== undefined &&
        response2.timing.ttfb !== undefined
      ) {
        diff.timing.ttfbDiff = response2.timing.ttfb - response1.timing.ttfb;
      }
      if (
        response1.timing.totalDuration !== undefined &&
        response2.timing.totalDuration !== undefined
      ) {
        diff.timing.totalDiff =
          response2.timing.totalDuration - response1.timing.totalDuration;
      }
    }

    return diff;
  }

  /**
   * Compare two raw strings and return differences
   */
  static compareRaw(
    str1: string,
    str2: string
  ): {
    identical: boolean;
    differences: Array<{ index: number; char1: string; char2: string }>;
    lengthDiff: number;
  } {
    const differences: Array<{ index: number; char1: string; char2: string }> =
      [];
    const maxLen = Math.max(str1.length, str2.length);

    for (let i = 0; i < maxLen; i++) {
      const char1 = str1[i] ?? "";
      const char2 = str2[i] ?? "";
      if (char1 !== char2) {
        differences.push({
          index: i,
          char1: char1 ? this.escapeChar(char1) : "<missing>",
          char2: char2 ? this.escapeChar(char2) : "<missing>",
        });
      }
    }

    return {
      identical: differences.length === 0,
      differences,
      lengthDiff: str2.length - str1.length,
    };
  }

  /**
   * Generate a summary of differences
   */
  static summarize(diff: RequestDiff | ResponseDiff): string[] {
    const summary: string[] = [];

    for (const [key, value] of Object.entries(diff)) {
      if (key === "raw" || key === "timing") continue;

      if (Array.isArray(value)) {
        // Headers array
        for (const h of value) {
          if (h.type !== "unchanged") {
            summary.push(
              `Header ${h.path}: ${h.type} (${h.oldValue ?? "none"} → ${
                h.newValue ?? "none"
              })`
            );
          }
        }
      } else if (value && typeof value === "object" && "type" in value) {
        if (value.type !== "unchanged") {
          summary.push(
            `${key}: ${value.type} (${value.oldValue ?? "none"} → ${
              value.newValue ?? "none"
            })`
          );
        }
      }
    }

    if ("timing" in diff && diff.timing) {
      if (diff.timing.ttfbDiff !== undefined) {
        summary.push(
          `TTFB difference: ${diff.timing.ttfbDiff > 0 ? "+" : ""}${
            diff.timing.ttfbDiff
          }ms`
        );
      }
      if (diff.timing.totalDiff !== undefined) {
        summary.push(
          `Total time difference: ${diff.timing.totalDiff > 0 ? "+" : ""}${
            diff.timing.totalDiff
          }ms`
        );
      }
    }

    return summary;
  }

  /**
   * Check if two requests/responses are identical
   */
  static isIdentical(diff: RequestDiff | ResponseDiff): boolean {
    for (const [key, value] of Object.entries(diff)) {
      if (key === "raw" || key === "timing") continue;

      if (Array.isArray(value)) {
        if (value.some((h) => h.type !== "unchanged")) return false;
      } else if (value && typeof value === "object" && "type" in value) {
        if (value.type !== "unchanged") return false;
      }
    }
    return true;
  }

  private static parseRequest(raw: string): {
    method: string;
    path: string;
    httpVersion: string;
    headers: Map<string, string[]>;
    body: string;
  } {
    const result = {
      method: "",
      path: "",
      httpVersion: "",
      headers: new Map<string, string[]>(),
      body: "",
    };

    let headerEnd = raw.indexOf("\r\n\r\n");
    let sepLen = 4;
    if (headerEnd === -1) {
      headerEnd = raw.indexOf("\n\n");
      sepLen = 2;
    }
    if (headerEnd === -1) {
      headerEnd = raw.length;
      sepLen = 0;
    }

    const headerSection = raw.substring(0, headerEnd);
    result.body = raw.substring(headerEnd + sepLen);

    const lines = headerSection.split(/\r?\n/);
    const requestLine = lines[0] || "";
    const match = requestLine.match(/^(\S+)\s+(\S+)\s+HTTP\/(.+)$/i);

    if (match && match[1] && match[2] && match[3]) {
      result.method = match[1];
      result.path = match[2];
      result.httpVersion = match[3];
    }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const name = line.substring(0, colonIdx).trim().toLowerCase();
        const value = line.substring(colonIdx + 1).trim();
        const existing = result.headers.get(name);
        if (existing) {
          existing.push(value);
        } else {
          result.headers.set(name, [value]);
        }
      }
    }

    return result;
  }

  private static compareField(
    path: string,
    val1: string | undefined,
    val2: string | undefined
  ): DiffResult | null {
    if (val1 === val2) {
      return { type: "unchanged", path, oldValue: val1, newValue: val2 };
    }
    if (val1 && !val2) {
      return { type: "removed", path, oldValue: val1 };
    }
    if (!val1 && val2) {
      return { type: "added", path, newValue: val2 };
    }
    return { type: "changed", path, oldValue: val1, newValue: val2 };
  }

  private static compareHeaders(
    headers1: Map<string, string[]>,
    headers2: Map<string, string[]>
  ): DiffResult[] {
    const results: DiffResult[] = [];
    const allKeys = new Set([...headers1.keys(), ...headers2.keys()]);

    for (const key of allKeys) {
      const val1 = headers1.get(key)?.join(", ");
      const val2 = headers2.get(key)?.join(", ");
      const diff = this.compareField(key, val1, val2);
      if (diff) results.push(diff);
    }

    return results;
  }

  private static compareResponseHeaders(
    headers1: Map<string, string[]>,
    headers2: Map<string, string[]>
  ): DiffResult[] {
    return this.compareHeaders(headers1, headers2);
  }

  private static generateUnifiedDiff(str1: string, str2: string): string {
    const lines1 = str1.split(/\r?\n/);
    const lines2 = str2.split(/\r?\n/);
    const output: string[] = [];

    const maxLines = Math.max(lines1.length, lines2.length);
    for (let i = 0; i < maxLines; i++) {
      const line1 = lines1[i];
      const line2 = lines2[i];

      if (line1 === line2) {
        output.push(`  ${line1 ?? ""}`);
      } else {
        if (line1 !== undefined) output.push(`- ${line1}`);
        if (line2 !== undefined) output.push(`+ ${line2}`);
      }
    }

    return output.join("\n");
  }

  private static escapeChar(char: string): string {
    const code = char.charCodeAt(0);
    if (code === 13) return "\\r";
    if (code === 10) return "\\n";
    if (code === 9) return "\\t";
    if (code === 0) return "\\0";
    if (code < 32 || code > 126)
      return `\\x${code.toString(16).padStart(2, "0")}`;
    return char;
  }
}
