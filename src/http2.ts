/**
 * httpforger - HTTP/2 Support
 *
 * HTTP/2 uses binary framing instead of text-based HTTP/1.x.
 * This module provides raw HTTP/2 frame construction and parsing.
 */

import type { TLSOptions, TimingMetrics, RawResponse } from "./types";

// ============================================================================
// HTTP/2 Constants
// ============================================================================

/** HTTP/2 connection preface - must be sent first */
export const HTTP2_PREFACE = Buffer.from(
  "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n",
  "ascii"
);

/** HTTP/2 Frame Types */
export enum Http2FrameType {
  DATA = 0x00,
  HEADERS = 0x01,
  PRIORITY = 0x02,
  RST_STREAM = 0x03,
  SETTINGS = 0x04,
  PUSH_PROMISE = 0x05,
  PING = 0x06,
  GOAWAY = 0x07,
  WINDOW_UPDATE = 0x08,
  CONTINUATION = 0x09,
}

/** HTTP/2 Frame Flags */
export enum Http2Flags {
  END_STREAM = 0x01,
  END_HEADERS = 0x04,
  PADDED = 0x08,
  PRIORITY = 0x20,
  ACK = 0x01, // For SETTINGS and PING
}

/** HTTP/2 Error Codes */
export enum Http2ErrorCode {
  NO_ERROR = 0x00,
  PROTOCOL_ERROR = 0x01,
  INTERNAL_ERROR = 0x02,
  FLOW_CONTROL_ERROR = 0x03,
  SETTINGS_TIMEOUT = 0x04,
  STREAM_CLOSED = 0x05,
  FRAME_SIZE_ERROR = 0x06,
  REFUSED_STREAM = 0x07,
  CANCEL = 0x08,
  COMPRESSION_ERROR = 0x09,
  CONNECT_ERROR = 0x0a,
  ENHANCE_YOUR_CALM = 0x0b,
  INADEQUATE_SECURITY = 0x0c,
  HTTP_1_1_REQUIRED = 0x0d,
}

/** HTTP/2 Settings Parameters */
export enum Http2Settings {
  HEADER_TABLE_SIZE = 0x01,
  ENABLE_PUSH = 0x02,
  MAX_CONCURRENT_STREAMS = 0x03,
  INITIAL_WINDOW_SIZE = 0x04,
  MAX_FRAME_SIZE = 0x05,
  MAX_HEADER_LIST_SIZE = 0x06,
}

// ============================================================================
// HTTP/2 Frame Interfaces
// ============================================================================

export interface Http2Frame {
  length: number;
  type: Http2FrameType;
  flags: number;
  streamId: number;
  payload: Buffer;
}

export interface Http2HeadersFrame extends Http2Frame {
  type: Http2FrameType.HEADERS;
  headers: Map<string, string>;
  priority?: {
    exclusive: boolean;
    dependency: number;
    weight: number;
  };
}

export interface Http2SettingsFrame extends Http2Frame {
  type: Http2FrameType.SETTINGS;
  settings: Map<Http2Settings, number>;
}

export interface Http2Response {
  streamId: number;
  statusCode: number;
  headers: Map<string, string[]>;
  body: Buffer;
  frames: Http2Frame[];
  timing?: TimingMetrics;
}

export interface Http2RequestOptions {
  method: string;
  path: string;
  authority: string;
  scheme?: "https" | "http";
  headers?: Record<string, string>;
  body?: string | Buffer;
}

// ============================================================================
// HPACK - Header Compression (Simplified)
// ============================================================================

/**
 * Static table for HPACK compression (RFC 7541)
 * This is a simplified version - full implementation would be more complex
 */
const HPACK_STATIC_TABLE: [string, string][] = [
  ["", ""], // Index 0 is unused
  [":authority", ""],
  [":method", "GET"],
  [":method", "POST"],
  [":path", "/"],
  [":path", "/index.html"],
  [":scheme", "http"],
  [":scheme", "https"],
  [":status", "200"],
  [":status", "204"],
  [":status", "206"],
  [":status", "304"],
  [":status", "400"],
  [":status", "404"],
  [":status", "500"],
  ["accept-charset", ""],
  ["accept-encoding", "gzip, deflate"],
  ["accept-language", ""],
  ["accept-ranges", ""],
  ["accept", ""],
  ["access-control-allow-origin", ""],
  ["age", ""],
  ["allow", ""],
  ["authorization", ""],
  ["cache-control", ""],
  ["content-disposition", ""],
  ["content-encoding", ""],
  ["content-language", ""],
  ["content-length", ""],
  ["content-location", ""],
  ["content-range", ""],
  ["content-type", ""],
  ["cookie", ""],
  ["date", ""],
  ["etag", ""],
  ["expect", ""],
  ["expires", ""],
  ["from", ""],
  ["host", ""],
  ["if-match", ""],
  ["if-modified-since", ""],
  ["if-none-match", ""],
  ["if-range", ""],
  ["if-unmodified-since", ""],
  ["last-modified", ""],
  ["link", ""],
  ["location", ""],
  ["max-forwards", ""],
  ["proxy-authenticate", ""],
  ["proxy-authorization", ""],
  ["range", ""],
  ["referer", ""],
  ["refresh", ""],
  ["retry-after", ""],
  ["server", ""],
  ["set-cookie", ""],
  ["strict-transport-security", ""],
  ["transfer-encoding", ""],
  ["user-agent", ""],
  ["vary", ""],
  ["via", ""],
  ["www-authenticate", ""],
];

/**
 * Simple HPACK encoder (literal without indexing)
 * For security testing, we often want to avoid compression
 */
export class HpackEncoder {
  // Dynamic table for future use (currently using static table only)
  // @ts-expect-error Reserved for full HPACK implementation
  private dynamicTable: [string, string][] = [];
  // @ts-expect-error Reserved for full HPACK implementation
  private dynamicTableSize = 0;
  // @ts-expect-error Reserved for full HPACK implementation
  private maxDynamicTableSize = 4096;

  /**
   * Encode headers without using dynamic table (for testing purposes)
   * This allows sending "raw" headers without compression artifacts
   */
  encodeHeadersLiteral(headers: Map<string, string>): Buffer {
    const buffers: Buffer[] = [];

    for (const [name, value] of headers) {
      // Check if name is in static table
      const staticIndex = this.findStaticTableIndex(name);

      if (staticIndex > 0) {
        // Literal Header Field without Indexing — Indexed Name
        // 0000xxxx format (4-bit prefix)
        buffers.push(Buffer.from([0x00 | staticIndex]));
        buffers.push(this.encodeString(value, false));
      } else {
        // Literal Header Field without Indexing — New Name
        // 00000000 format
        buffers.push(Buffer.from([0x00]));
        buffers.push(this.encodeString(name, false));
        buffers.push(this.encodeString(value, false));
      }
    }

    return Buffer.concat(buffers);
  }

  /**
   * Encode headers with indexing (standard HPACK)
   */
  encodeHeaders(headers: Map<string, string>): Buffer {
    const buffers: Buffer[] = [];

    for (const [name, value] of headers) {
      // Check static table for exact match
      const exactIndex = this.findStaticTableExactIndex(name, value);
      if (exactIndex > 0) {
        // Indexed Header Field (1xxxxxxx)
        buffers.push(this.encodeInteger(exactIndex, 7, 0x80));
        continue;
      }

      // Check for name match in static table
      const nameIndex = this.findStaticTableIndex(name);
      if (nameIndex > 0) {
        // Literal Header Field with Incremental Indexing — Indexed Name
        // 01xxxxxx format (6-bit prefix)
        buffers.push(this.encodeInteger(nameIndex, 6, 0x40));
        buffers.push(this.encodeString(value, false));
      } else {
        // Literal Header Field with Incremental Indexing — New Name
        // 01000000 format
        buffers.push(Buffer.from([0x40]));
        buffers.push(this.encodeString(name, false));
        buffers.push(this.encodeString(value, false));
      }
    }

    return Buffer.concat(buffers);
  }

  /**
   * Encode a string (with or without Huffman coding)
   */
  private encodeString(str: string, huffman = false): Buffer {
    const strBytes = Buffer.from(str, "utf-8");

    if (huffman) {
      // Huffman encoding not implemented - would need full Huffman table
      // For now, fall back to literal
    }

    // Literal string (H=0)
    const lengthBuf = this.encodeInteger(strBytes.length, 7, 0x00);
    return Buffer.concat([lengthBuf, strBytes]);
  }

  /**
   * Encode an integer with prefix
   */
  private encodeInteger(
    value: number,
    prefixBits: number,
    prefixValue: number
  ): Buffer {
    const maxPrefix = (1 << prefixBits) - 1;

    if (value < maxPrefix) {
      return Buffer.from([prefixValue | value]);
    }

    const result: number[] = [prefixValue | maxPrefix];
    value -= maxPrefix;

    while (value >= 128) {
      result.push((value % 128) + 128);
      value = Math.floor(value / 128);
    }
    result.push(value);

    return Buffer.from(result);
  }

  private findStaticTableIndex(name: string): number {
    const lowerName = name.toLowerCase();
    for (let i = 1; i < HPACK_STATIC_TABLE.length; i++) {
      if (HPACK_STATIC_TABLE[i]![0] === lowerName) {
        return i;
      }
    }
    return 0;
  }

  private findStaticTableExactIndex(name: string, value: string): number {
    const lowerName = name.toLowerCase();
    for (let i = 1; i < HPACK_STATIC_TABLE.length; i++) {
      const entry = HPACK_STATIC_TABLE[i]!;
      if (entry[0] === lowerName && entry[1] === value) {
        return i;
      }
    }
    return 0;
  }
}

/**
 * Simple HPACK decoder
 */
export class HpackDecoder {
  private dynamicTable: [string, string][] = [];

  decodeHeaders(buffer: Buffer): Map<string, string> {
    const headers = new Map<string, string>();
    let offset = 0;

    while (offset < buffer.length) {
      const byte = buffer[offset]!;

      if (byte & 0x80) {
        // Indexed Header Field
        const { value: index, bytesRead } = this.decodeInteger(
          buffer,
          offset,
          7
        );
        offset += bytesRead;

        const entry = this.getTableEntry(index);
        if (entry) {
          headers.set(entry[0], entry[1]);
        }
      } else if (byte & 0x40) {
        // Literal Header Field with Incremental Indexing
        const { value: nameIndex, bytesRead: indexBytes } = this.decodeInteger(
          buffer,
          offset,
          6
        );
        offset += indexBytes;

        let name: string;
        if (nameIndex > 0) {
          const entry = this.getTableEntry(nameIndex);
          name = entry ? entry[0] : "";
        } else {
          const { value: nameStr, bytesRead: nameBytes } = this.decodeString(
            buffer,
            offset
          );
          name = nameStr;
          offset += nameBytes;
        }

        const { value, bytesRead: valueBytes } = this.decodeString(
          buffer,
          offset
        );
        offset += valueBytes;

        headers.set(name, value);
        this.dynamicTable.unshift([name, value]);
      } else if (byte & 0x20) {
        // Dynamic Table Size Update
        const { value: maxSize, bytesRead } = this.decodeInteger(
          buffer,
          offset,
          5
        );
        offset += bytesRead;
        // Update max size (simplified - just clear if 0)
        if (maxSize === 0) {
          this.dynamicTable = [];
        }
      } else {
        // Literal Header Field without Indexing / Never Indexed
        const prefix = byte & 0x10 ? 4 : 4;
        const { value: nameIndex, bytesRead: indexBytes } = this.decodeInteger(
          buffer,
          offset,
          prefix
        );
        offset += indexBytes;

        let name: string;
        if (nameIndex > 0) {
          const entry = this.getTableEntry(nameIndex);
          name = entry ? entry[0] : "";
        } else {
          const { value: nameStr, bytesRead: nameBytes } = this.decodeString(
            buffer,
            offset
          );
          name = nameStr;
          offset += nameBytes;
        }

        const { value, bytesRead: valueBytes } = this.decodeString(
          buffer,
          offset
        );
        offset += valueBytes;

        headers.set(name, value);
      }
    }

    return headers;
  }

  private decodeInteger(
    buffer: Buffer,
    offset: number,
    prefixBits: number
  ): { value: number; bytesRead: number } {
    const maxPrefix = (1 << prefixBits) - 1;
    let value = buffer[offset]! & maxPrefix;
    let bytesRead = 1;

    if (value === maxPrefix) {
      let m = 0;
      let byte: number;
      do {
        byte = buffer[offset + bytesRead]!;
        bytesRead++;
        value += (byte & 0x7f) << m;
        m += 7;
      } while (byte & 0x80);
    }

    return { value, bytesRead };
  }

  private decodeString(
    buffer: Buffer,
    offset: number
  ): { value: string; bytesRead: number } {
    const huffman = !!(buffer[offset]! & 0x80);
    const { value: length, bytesRead: lenBytes } = this.decodeInteger(
      buffer,
      offset,
      7
    );

    const strStart = offset + lenBytes;
    const strBytes = buffer.subarray(strStart, strStart + length);

    let value: string;
    if (huffman) {
      // Huffman decoding not fully implemented
      // For now, try to read as-is (won't work for actual Huffman-encoded data)
      value = strBytes.toString("utf-8");
    } else {
      value = strBytes.toString("utf-8");
    }

    return { value, bytesRead: lenBytes + length };
  }

  private getTableEntry(index: number): [string, string] | undefined {
    if (index <= 0) return undefined;

    if (index < HPACK_STATIC_TABLE.length) {
      return HPACK_STATIC_TABLE[index];
    }

    const dynamicIndex = index - HPACK_STATIC_TABLE.length;
    return this.dynamicTable[dynamicIndex];
  }
}

// ============================================================================
// HTTP/2 Frame Builder
// ============================================================================

export class Http2FrameBuilder {
  private hpackEncoder = new HpackEncoder();

  /**
   * Build a raw HTTP/2 frame
   */
  buildFrame(
    type: Http2FrameType,
    flags: number,
    streamId: number,
    payload: Buffer
  ): Buffer {
    const header = Buffer.alloc(9);

    // Length (24 bits)
    header.writeUIntBE(payload.length, 0, 3);

    // Type (8 bits)
    header.writeUInt8(type, 3);

    // Flags (8 bits)
    header.writeUInt8(flags, 4);

    // Stream Identifier (31 bits, R bit is reserved and must be 0)
    header.writeUInt32BE(streamId & 0x7fffffff, 5);

    return Buffer.concat([header, payload]);
  }

  /**
   * Build SETTINGS frame
   */
  buildSettingsFrame(
    settings: Map<Http2Settings, number>,
    ack = false
  ): Buffer {
    if (ack) {
      return this.buildFrame(
        Http2FrameType.SETTINGS,
        Http2Flags.ACK,
        0,
        Buffer.alloc(0)
      );
    }

    const payload = Buffer.alloc(settings.size * 6);
    let offset = 0;

    for (const [id, value] of settings) {
      payload.writeUInt16BE(id, offset);
      payload.writeUInt32BE(value, offset + 2);
      offset += 6;
    }

    return this.buildFrame(Http2FrameType.SETTINGS, 0, 0, payload);
  }

  /**
   * Build HEADERS frame
   */
  buildHeadersFrame(
    streamId: number,
    headers: Map<string, string>,
    endStream = false,
    endHeaders = true,
    useLiteralEncoding = false
  ): Buffer {
    const headerBlock = useLiteralEncoding
      ? this.hpackEncoder.encodeHeadersLiteral(headers)
      : this.hpackEncoder.encodeHeaders(headers);

    let flags = 0;
    if (endStream) flags |= Http2Flags.END_STREAM;
    if (endHeaders) flags |= Http2Flags.END_HEADERS;

    return this.buildFrame(
      Http2FrameType.HEADERS,
      flags,
      streamId,
      headerBlock
    );
  }

  /**
   * Build DATA frame
   */
  buildDataFrame(
    streamId: number,
    data: Buffer,
    endStream = true,
    padLength?: number
  ): Buffer {
    let flags = 0;
    if (endStream) flags |= Http2Flags.END_STREAM;

    let payload: Buffer;
    if (padLength !== undefined && padLength > 0) {
      flags |= Http2Flags.PADDED;
      payload = Buffer.alloc(1 + data.length + padLength);
      payload.writeUInt8(padLength, 0);
      data.copy(payload, 1);
      // Padding is zeros (already initialized)
    } else {
      payload = data;
    }

    return this.buildFrame(Http2FrameType.DATA, flags, streamId, payload);
  }

  /**
   * Build WINDOW_UPDATE frame
   */
  buildWindowUpdateFrame(streamId: number, increment: number): Buffer {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(increment & 0x7fffffff, 0);
    return this.buildFrame(Http2FrameType.WINDOW_UPDATE, 0, streamId, payload);
  }

  /**
   * Build PING frame
   */
  buildPingFrame(data: Buffer, ack = false): Buffer {
    const payload = Buffer.alloc(8);
    data.copy(payload, 0, 0, Math.min(8, data.length));
    const flags = ack ? Http2Flags.ACK : 0;
    return this.buildFrame(Http2FrameType.PING, flags, 0, payload);
  }

  /**
   * Build GOAWAY frame
   */
  buildGoawayFrame(
    lastStreamId: number,
    errorCode: Http2ErrorCode,
    debugData?: Buffer
  ): Buffer {
    const payload = Buffer.alloc(8 + (debugData?.length ?? 0));
    payload.writeUInt32BE(lastStreamId & 0x7fffffff, 0);
    payload.writeUInt32BE(errorCode, 4);
    if (debugData) {
      debugData.copy(payload, 8);
    }
    return this.buildFrame(Http2FrameType.GOAWAY, 0, 0, payload);
  }

  /**
   * Build RST_STREAM frame
   */
  buildRstStreamFrame(streamId: number, errorCode: Http2ErrorCode): Buffer {
    const payload = Buffer.alloc(4);
    payload.writeUInt32BE(errorCode, 0);
    return this.buildFrame(Http2FrameType.RST_STREAM, 0, streamId, payload);
  }

  /**
   * Build PRIORITY frame
   */
  buildPriorityFrame(
    streamId: number,
    dependency: number,
    weight: number,
    exclusive = false
  ): Buffer {
    const payload = Buffer.alloc(5);
    const depValue = exclusive ? dependency | 0x80000000 : dependency;
    payload.writeUInt32BE(depValue, 0);
    payload.writeUInt8(weight - 1, 4); // Weight is 1-256, encoded as 0-255
    return this.buildFrame(Http2FrameType.PRIORITY, 0, streamId, payload);
  }

  /**
   * Build a complete HTTP/2 request (preface + settings + headers + data)
   */
  buildRequest(options: Http2RequestOptions): Buffer {
    const frames: Buffer[] = [];

    // Connection preface
    frames.push(HTTP2_PREFACE);

    // Initial SETTINGS frame
    const settings = new Map<Http2Settings, number>();
    settings.set(Http2Settings.MAX_CONCURRENT_STREAMS, 100);
    settings.set(Http2Settings.INITIAL_WINDOW_SIZE, 65535);
    frames.push(this.buildSettingsFrame(settings));

    // Build pseudo-headers + regular headers
    const headers = new Map<string, string>();
    headers.set(":method", options.method);
    headers.set(":path", options.path);
    headers.set(":scheme", options.scheme ?? "https");
    headers.set(":authority", options.authority);

    // Add custom headers
    if (options.headers) {
      for (const [name, value] of Object.entries(options.headers)) {
        headers.set(name.toLowerCase(), value);
      }
    }

    const hasBody = options.body && options.body.length > 0;
    const streamId = 1; // First client-initiated stream

    // HEADERS frame
    frames.push(this.buildHeadersFrame(streamId, headers, !hasBody, true));

    // DATA frame if body present
    if (hasBody) {
      const bodyBuffer =
        typeof options.body === "string"
          ? Buffer.from(options.body)
          : options.body!;
      frames.push(this.buildDataFrame(streamId, bodyBuffer, true));
    }

    return Buffer.concat(frames);
  }
}

// ============================================================================
// HTTP/2 Frame Parser
// ============================================================================

export class Http2FrameParser {
  private hpackDecoder = new HpackDecoder();

  /**
   * Parse a single HTTP/2 frame from buffer
   */
  parseFrame(
    buffer: Buffer,
    offset = 0
  ): { frame: Http2Frame; bytesRead: number } | null {
    if (buffer.length - offset < 9) {
      return null; // Not enough data for frame header
    }

    const length = buffer.readUIntBE(offset, 3);
    const type = buffer.readUInt8(offset + 3) as Http2FrameType;
    const flags = buffer.readUInt8(offset + 4);
    const streamId = buffer.readUInt32BE(offset + 5) & 0x7fffffff;

    if (buffer.length - offset < 9 + length) {
      return null; // Not enough data for full frame
    }

    const payload = buffer.subarray(offset + 9, offset + 9 + length);

    return {
      frame: { length, type, flags, streamId, payload },
      bytesRead: 9 + length,
    };
  }

  /**
   * Parse all frames from a buffer
   */
  parseAllFrames(buffer: Buffer): Http2Frame[] {
    const frames: Http2Frame[] = [];
    let offset = 0;

    while (offset < buffer.length) {
      const result = this.parseFrame(buffer, offset);
      if (!result) break;

      frames.push(result.frame);
      offset += result.bytesRead;
    }

    return frames;
  }

  /**
   * Parse HEADERS frame payload
   */
  parseHeadersPayload(frame: Http2Frame): {
    headers: Map<string, string>;
    priority?: { exclusive: boolean; dependency: number; weight: number };
  } {
    let offset = 0;
    let priority:
      | { exclusive: boolean; dependency: number; weight: number }
      | undefined;
    let padLength = 0;

    if (frame.flags & Http2Flags.PADDED) {
      padLength = frame.payload.readUInt8(offset);
      offset += 1;
    }

    if (frame.flags & Http2Flags.PRIORITY) {
      const depField = frame.payload.readUInt32BE(offset);
      priority = {
        exclusive: !!(depField & 0x80000000),
        dependency: depField & 0x7fffffff,
        weight: frame.payload.readUInt8(offset + 4) + 1,
      };
      offset += 5;
    }

    const headerBlockEnd = frame.payload.length - padLength;
    const headerBlock = frame.payload.subarray(offset, headerBlockEnd);

    const headers = this.hpackDecoder.decodeHeaders(headerBlock);

    return { headers, priority };
  }

  /**
   * Parse SETTINGS frame payload
   */
  parseSettingsPayload(frame: Http2Frame): Map<Http2Settings, number> {
    const settings = new Map<Http2Settings, number>();

    for (let i = 0; i < frame.payload.length; i += 6) {
      const id = frame.payload.readUInt16BE(i) as Http2Settings;
      const value = frame.payload.readUInt32BE(i + 2);
      settings.set(id, value);
    }

    return settings;
  }

  /**
   * Extract response from frames
   */
  extractResponse(
    frames: Http2Frame[],
    streamId: number
  ): Http2Response | null {
    const streamFrames = frames.filter(
      (f) => f.streamId === streamId || f.streamId === 0
    );
    const headersFrame = streamFrames.find(
      (f) => f.type === Http2FrameType.HEADERS
    );

    if (!headersFrame) return null;

    const { headers: headerMap } = this.parseHeadersPayload(headersFrame);

    // Convert to response format
    const headers = new Map<string, string[]>();
    let statusCode = 200;

    for (const [name, value] of headerMap) {
      if (name === ":status") {
        statusCode = parseInt(value, 10);
      } else if (!name.startsWith(":")) {
        const existing = headers.get(name);
        if (existing) {
          existing.push(value);
        } else {
          headers.set(name, [value]);
        }
      }
    }

    // Collect DATA frames
    const dataFrames = streamFrames.filter(
      (f) => f.type === Http2FrameType.DATA
    );
    const body = Buffer.concat(dataFrames.map((f) => f.payload));

    return {
      streamId,
      statusCode,
      headers,
      body,
      frames: streamFrames,
    };
  }
}

// ============================================================================
// HTTP/2 Client
// ============================================================================

export class Http2Client {
  private defaultTimeout: number = 30000;
  private frameBuilder = new Http2FrameBuilder();
  private frameParser = new Http2FrameParser();

  constructor(options?: { defaultTimeout?: number }) {
    if (options?.defaultTimeout) {
      this.defaultTimeout = options.defaultTimeout;
    }
  }

  /**
   * Send an HTTP/2 request
   * Note: HTTP/2 typically requires TLS with ALPN negotiation
   */
  async sendRequest(options: {
    host: string;
    port?: number;
    tls?: TLSOptions;
    timeout?: number;
    request: Http2RequestOptions;
    collectTiming?: boolean;
  }): Promise<Http2Response & { rawResponse: RawResponse }> {
    const {
      host,
      port = 443,
      tls,
      timeout = this.defaultTimeout,
      request,
      collectTiming = false,
    } = options;

    // Build the complete HTTP/2 request
    const requestData = this.frameBuilder.buildRequest({
      ...request,
      authority: request.authority || host,
      scheme: "https",
    });

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

      const resolveOnce = (data: Buffer) => {
        if (!resolved) {
          resolved = true;
          if (collectTiming) {
            timing.endTime = Date.now();
            timing.totalDuration = timing.endTime - timing.startTime;
          }
          cleanup();

          // Parse HTTP/2 frames
          const frames = this.frameParser.parseAllFrames(data);
          const http2Response = this.frameParser.extractResponse(frames, 1);

          if (!http2Response) {
            reject(new Error("Failed to parse HTTP/2 response"));
            return;
          }

          if (collectTiming) {
            http2Response.timing = timing;
          }

          // Create a RawResponse for compatibility
          const rawResponse: RawResponse = {
            raw: data.toString("utf-8"),
            rawBuffer: data,
            statusCode: http2Response.statusCode,
            statusMessage: "",
            httpVersion: "2",
            headers: http2Response.headers,
            body: http2Response.body.toString("utf-8"),
            bodyBuffer: http2Response.body,
            timing: collectTiming ? timing : undefined,
          };

          resolve({ ...http2Response, rawResponse });
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

      Bun.connect({
        hostname: host,
        port,
        tls: {
          rejectUnauthorized: tls?.rejectUnauthorized ?? false,
          serverName: tls?.servername ?? host,
          // Request HTTP/2 via ALPN
          requestCert: false,
          ...tls,
        } as Parameters<typeof Bun.connect>[0]["tls"],
        socket: {
          open(sock) {
            socket = sock;
            if (collectTiming) timing.connectTime = Date.now();
            sock.write(requestData);
          },
          data(_sock, chunk: Buffer) {
            if (collectTiming && !timing.firstByteTime) {
              timing.firstByteTime = Date.now();
              timing.ttfb = timing.firstByteTime - timing.startTime;
            }
            responseData = Buffer.concat([responseData, chunk]);
          },
          close() {
            resolveOnce(responseData);
          },
          error(_sock, error: Error) {
            rejectOnce(new Error(`Socket error: ${error.message}`));
          },
          end() {
            resolveOnce(responseData);
          },
          connectError(_sock, error: Error) {
            rejectOnce(new Error(`Connection error: ${error.message}`));
          },
        },
      }).catch(rejectOnce);
    });
  }

  /**
   * Send raw HTTP/2 frames
   */
  async sendRawFrames(options: {
    host: string;
    port?: number;
    tls?: TLSOptions;
    timeout?: number;
    frames: Buffer;
    collectTiming?: boolean;
  }): Promise<{
    frames: Http2Frame[];
    rawBuffer: Buffer;
    timing?: TimingMetrics;
  }> {
    const {
      host,
      port = 443,
      tls,
      timeout = this.defaultTimeout,
      frames: requestFrames,
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
            // Ignore
          }
        }
      };

      const resolveOnce = (data: Buffer) => {
        if (!resolved) {
          resolved = true;
          if (collectTiming) {
            timing.endTime = Date.now();
            timing.totalDuration = timing.endTime - timing.startTime;
          }
          cleanup();

          const frames = this.frameParser.parseAllFrames(data);
          resolve({
            frames,
            rawBuffer: data,
            timing: collectTiming ? timing : undefined,
          });
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

      Bun.connect({
        hostname: host,
        port,
        tls: {
          rejectUnauthorized: tls?.rejectUnauthorized ?? false,
          serverName: tls?.servername ?? host,
          ...tls,
        } as Parameters<typeof Bun.connect>[0]["tls"],
        socket: {
          open(sock) {
            socket = sock;
            if (collectTiming) timing.connectTime = Date.now();
            sock.write(requestFrames);
          },
          data(_sock, chunk: Buffer) {
            if (collectTiming && !timing.firstByteTime) {
              timing.firstByteTime = Date.now();
              timing.ttfb = timing.firstByteTime - timing.startTime;
            }
            responseData = Buffer.concat([responseData, chunk]);
          },
          close() {
            resolveOnce(responseData);
          },
          error(_sock, error: Error) {
            rejectOnce(new Error(`Socket error: ${error.message}`));
          },
          end() {
            resolveOnce(responseData);
          },
          connectError(_sock, error: Error) {
            rejectOnce(new Error(`Connection error: ${error.message}`));
          },
        },
      }).catch(rejectOnce);
    });
  }

  /**
   * Get the frame builder for manual frame construction
   */
  get builder(): Http2FrameBuilder {
    return this.frameBuilder;
  }

  /**
   * Get the frame parser for manual frame parsing
   */
  get parser(): Http2FrameParser {
    return this.frameParser;
  }
}
