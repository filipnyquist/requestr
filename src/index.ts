/**
 * requestr - A Bun.js library for sending raw HTTP/HTTPS requests
 * Supports intentionally malformed payloads for security testing and protocol research
 *
 * WARNING: This library is intended for authorized security testing only.
 * Do not use against systems without explicit permission.
 */

// =============================================================================
// Types
// =============================================================================

export type {
  RequestOptions,
  ConnectionOptions,
  TLSOptions,
  TimingMetrics,
  RawResponse,
  ProxyOptions,
  SendOptions,
  MalformationType,
  EncodingType,
  DiffResult,
  RequestDiff,
  ResponseDiff,
  PooledConnection,
  // New unified types
  FetchRequestOptions,
  UnifiedResponse,
  ClientMode,
  HttpClientOptions,
  UnifiedRequestOptions,
} from "./types";

// =============================================================================
// Core Classes
// =============================================================================

// Unified Client (recommended entry point)
export { HttpClient, UnifiedResponseAnalyzer } from "./unified";
export type { HttpClientResponse } from "./unified";

// Request Builder
export { RequestBuilder } from "./builder";
export type { FetchInit, Http2Headers } from "./builder";

// Response Parsing
export { ResponseParser, ResponseAnalyzer } from "./response";

// Utilities
export { Encoder } from "./encoder";
export { Diff } from "./diff";
export { ConnectionPool } from "./pool";

// =============================================================================
// Backend-Specific Clients
// =============================================================================

// Fetch-based client
export { FetchClient, fetchRequest } from "./fetch";
export type { FetchResponse } from "./fetch";

// Raw HTTP/1.x client
export { RawHttp } from "./client";

// HTTP/2 Support
export {
  Http2Client,
  Http2FrameBuilder,
  Http2FrameParser,
  HpackEncoder,
  HpackDecoder,
  HTTP2_PREFACE,
  Http2FrameType,
  Http2Flags,
  Http2ErrorCode,
  Http2Settings,
} from "./http2";
export type {
  Http2Frame,
  Http2HeadersFrame,
  Http2SettingsFrame,
  Http2Response,
  Http2RequestOptions,
} from "./http2";

// =============================================================================
// Convenience Exports
// =============================================================================

import { HttpClient } from "./unified";
import { Encoder } from "./encoder";
import { Diff } from "./diff";

/** Pre-configured HttpClient instance with default settings (recommended) */
export const client = new HttpClient();

/** Create a new RequestBuilder instance */
export const request = HttpClient.request;

/** Encode a string using the specified encoding type */
export const encode = Encoder.encode.bind(Encoder);

/** Diff utilities for comparing requests and responses */
export const diff = Diff;

// =============================================================================
// Default Export
// =============================================================================

/** HttpClient is the default export (unified swiss-army knife client) */
export default HttpClient;
