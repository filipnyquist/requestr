/**
 * httpforger - URL Encoding Utilities
 */

import type { EncodingType } from "./types";

export class Encoder {
  /**
   * Encode a string using the specified encoding type
   */
  static encode(str: string, type: EncodingType): string {
    switch (type) {
      case "url":
        return this.urlEncode(str);
      case "double-url":
        return this.urlEncode(this.urlEncode(str));
      case "unicode":
        return this.unicodeEncode(str);
      case "hex":
        return this.hexEncode(str);
      case "octal":
        return this.octalEncode(str);
      case "html-entity":
        return this.htmlEntityEncode(str);
      case "base64":
        return Buffer.from(str).toString("base64");
      case "overlong-utf8":
        return this.overlongUtf8Encode(str);
      default:
        return str;
    }
  }

  /**
   * Decode a string from the specified encoding type
   */
  static decode(str: string, type: EncodingType): string {
    switch (type) {
      case "url":
        return decodeURIComponent(str);
      case "double-url":
        return decodeURIComponent(decodeURIComponent(str));
      case "base64":
        return Buffer.from(str, "base64").toString("utf-8");
      case "html-entity":
        return this.htmlEntityDecode(str);
      default:
        return str;
    }
  }

  /**
   * URL encode a string
   */
  static urlEncode(str: string): string {
    return encodeURIComponent(str).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    );
  }

  /**
   * URL encode all characters (not just special ones)
   */
  static urlEncodeAll(str: string): string {
    return Array.from(str)
      .map(
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
      )
      .join("");
  }

  /**
   * Unicode escape encoding (\uXXXX)
   */
  static unicodeEncode(str: string): string {
    return Array.from(str)
      .map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
      .join("");
  }

  /**
   * Hex encoding (\xXX)
   */
  static hexEncode(str: string): string {
    return Array.from(str)
      .map((c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("");
  }

  /**
   * Octal encoding (\XXX)
   */
  static octalEncode(str: string): string {
    return Array.from(str)
      .map((c) => `\\${c.charCodeAt(0).toString(8).padStart(3, "0")}`)
      .join("");
  }

  /**
   * HTML entity encoding (&#xXX; or &#DDD;)
   */
  static htmlEntityEncode(str: string, useHex = true): string {
    return Array.from(str)
      .map((c) =>
        useHex ? `&#x${c.charCodeAt(0).toString(16)};` : `&#${c.charCodeAt(0)};`
      )
      .join("");
  }

  /**
   * Decode HTML entities
   */
  static htmlEntityDecode(str: string): string {
    return str
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
  }

  /**
   * Overlong UTF-8 encoding (for bypass attempts)
   * Only works for ASCII characters (< 128)
   */
  static overlongUtf8Encode(str: string): string {
    const result: number[] = [];
    for (const char of str) {
      const code = char.charCodeAt(0);
      if (code < 128) {
        // 2-byte overlong encoding for ASCII
        result.push(0xc0 | (code >> 6));
        result.push(0x80 | (code & 0x3f));
      } else {
        // For non-ASCII, use normal encoding
        result.push(code);
      }
    }
    return Buffer.from(result).toString("binary");
  }

  /**
   * Mixed encoding - randomly apply different encodings to each character
   */
  static mixedEncode(str: string, types: EncodingType[]): string {
    return Array.from(str)
      .map((c) => {
        const type = types[Math.floor(Math.random() * types.length)];
        return type ? this.encode(c, type) : c;
      })
      .join("");
  }

  /**
   * Path traversal variations
   */
  static pathTraversal(depth: number, encoding?: EncodingType): string {
    let traversal = "../".repeat(depth);
    if (encoding) {
      traversal = this.encode(traversal, encoding);
    }
    return traversal;
  }

  /**
   * Common path traversal bypass patterns
   */
  static pathTraversalVariants(depth: number): string[] {
    const base = "../".repeat(depth);
    return [
      base,
      "..\\".repeat(depth),
      this.urlEncode(base),
      this.urlEncode(this.urlEncode(base)),
      base.replace(/\.\./g, "..%00"),
      base.replace(/\.\./g, "..%2500"),
      base.replace(/\//g, "%2f"),
      base.replace(/\//g, "%252f"),
      "....//".repeat(depth),
      "..;/".repeat(depth),
      "..\\/".repeat(depth),
      "..%c0%af".repeat(depth), // Overlong encoding of /
      "..%c1%9c".repeat(depth), // Overlong encoding of \
    ];
  }
}
