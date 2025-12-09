# requestrr

A Bun.js HTTP toolkit with three backends: **fetch** (standard), **raw HTTP/1.x** (byte-level control), and **HTTP/2** (frame-level control). Built for security testing with full support for malformed requests.

> ⚠️ **In early beta.** This package is still very experimental.

## Installation

```bash
bun add requestrr
```

## Quick Start

```typescript
import HttpClient from "requestrr";

const http = new HttpClient();

// Standard fetch request
const response = await http.fetch("https://api.example.com/users");
console.log(response.status, response.body);

// Or use static helpers
const data = await HttpClient.get("https://api.example.com/users");
const created = await HttpClient.post("https://api.example.com/users", {
  name: "Alice",
});
```

## Three Backends

| Backend          | Method         | Use Case                                     |
| ---------------- | -------------- | -------------------------------------------- |
| **Fetch**        | `http.fetch()` | Standard HTTP requests                       |
| **Raw HTTP/1.x** | `http.raw()`   | Byte-level control, malformation, smuggling  |
| **HTTP/2**       | `http.http2()` | Frame-level control, binary protocol testing |

```typescript
const http = new HttpClient({ collectTiming: true });

// Same request builder works with all backends
const request = HttpClient.request()
  .url("https://api.example.com/data")
  .method("POST")
  .header("Content-Type", "application/json")
  .jsonBody({ key: "value" });

// Standard fetch
const fetchResp = await http.fetch(request);

// Raw HTTP/1.x (needs host/port/scheme)
const rawResp = await http.raw(
  request.host("api.example.com").port(443).scheme("https")
);

// HTTP/2
const h2Resp = await http.http2(request.host("api.example.com").port(443));
```

## Response Format

All backends return a unified response:

```typescript
interface HttpClientResponse {
  ok: boolean; // Status 200-299
  status: number;
  statusText: string;
  headers: Map<string, string[]>;
  body: string;
  bodyBuffer: Buffer;
  httpVersion: string; // "1.0", "1.1", or "2"
  timing?: TimingMetrics;
  backend: "fetch" | "raw" | "http2";
  analyzer: UnifiedResponseAnalyzer;
}
```

### Response Analyzer

```typescript
const response = await http.fetch("https://example.com");

// Status checks
response.analyzer.isSuccess(); // 2xx
response.analyzer.isRedirect(); // 3xx
response.analyzer.isClientError(); // 4xx
response.analyzer.isServerError(); // 5xx

// Body/header inspection
response.analyzer.bodyContains("error");
response.analyzer.bodyMatches(/pattern/);
response.analyzer.hasHeader("Content-Type");
response.analyzer.getHeader("Set-Cookie"); // string[]
response.analyzer.getCookies();
```

---

## Raw HTTP/1.x

For security testing with full byte-level control:

```typescript
import HttpClient, { RawHttp } from "requestrr";

const http = new HttpClient();

// Via unified client
const response = await http.raw({
  host: "target.com",
  port: 443,
  protocol: "https",
  request: { method: "GET", path: "/", headers: { Host: "target.com" } },
});

// Send raw bytes directly
await http.rawSend({
  host: "target.com",
  port: 80,
  data: "GET / HTTP/1.1\r\nHost: target.com\r\n\r\n",
});

// Or use RawHttp directly
const client = new RawHttp();
const resp = await client.sendRequest({
  host: "target.com",
  port: 80,
  request: "...",
});
```

### Malformed Requests

```typescript
const request = RawHttp.request()
  .method("GET")
  .path("/admin")
  .header("Host", "target.com")
  .malformedHeader("X-Test", "value", "space-before-colon") // "X-Test : value"
  .duplicateHeader("Content-Length", ["100", "50"])
  .rawHeader("Invalid-Header\r\nInjected: yes")
  .useLfOnly() // LF-only line endings (no CR)
  .build();
```

**Malformation types:** `space-before-colon`, `tab-separator`, `no-space-after-colon`, `crlf-injection`, `null-byte`, `oversized-header`, `empty-header-name`, `empty-header-value`

### HTTP Smuggling Helpers

```typescript
// CL.TE smuggling
const clte = RawHttp.smugglingCLTE({
  host: "target.com",
  path: "/",
  contentLength: 6,
  body: "0\r\n\r\nG",
});

// TE.CL smuggling
const tecl = RawHttp.smugglingTECL({
  host: "target.com",
  contentLength: 4,
  body: "5c\r\nGPOST / HTTP/1.1\r\n...",
});

// Transfer-Encoding obfuscation
const obfuscated = RawHttp.obfuscatedTransferEncoding({
  host: "target.com",
  obfuscation: "tab", // space, tab, case, null, vertical-tab, newline
  body: "0\r\n\r\n",
});
```

### Other Attack Patterns

```typescript
// CRLF injection
RawHttp.crlfInjection({
  host: "target.com",
  headerName: "X-Custom",
  injectedHeaders: "Set-Cookie: evil=true",
});

// Host header attacks
RawHttp.hostHeaderAttack({
  legitimateHost: "target.com",
  attackHost: "evil.com",
  attackType: "duplicate",
});

// Null byte injection
RawHttp.nullByteInjection({ host: "target.com", path: "/admin", inPath: true });

// HTTP method override
RawHttp.methodOverride({
  host: "target.com",
  actualMethod: "POST",
  overrideMethod: "DELETE",
});
```

---

## HTTP/2

Binary frame-level control for HTTP/2 testing:

```typescript
import { Http2Client, Http2FrameBuilder, Http2Settings, HTTP2_PREFACE } from "requestrr";

const http = new HttpClient();

// Via unified client
const response = await http.http2({
  host: "example.com",
  port: 443,
  request: { method: "GET", path: "/", authority: "example.com" },
});

// Or use Http2Client directly
const client = new Http2Client();
const resp = await client.sendRequest({ host: "example.com", port: 443, request: {...} });
```

### Custom Frames

```typescript
const builder = new Http2FrameBuilder();

// Settings frame
const settings = builder.buildSettingsFrame(
  new Map([
    [Http2Settings.MAX_CONCURRENT_STREAMS, 100],
    [Http2Settings.INITIAL_WINDOW_SIZE, 65535],
  ])
);

// Headers frame
const headers = new Map([
  [":method", "GET"],
  [":path", "/admin"],
  [":scheme", "https"],
  [":authority", "target.com"],
]);
const headersFrame = builder.buildHeadersFrame(1, headers, true, true);

// Send raw frames
const result = await client.sendRawFrames({
  host: "target.com",
  frames: Buffer.concat([HTTP2_PREFACE, settings, headersFrame]),
});
```

### HTTP/2 Frame Types

| Frame           | Use Case                            |
| --------------- | ----------------------------------- |
| `DATA`          | Request/response body               |
| `HEADERS`       | HTTP headers with HPACK compression |
| `SETTINGS`      | Connection configuration            |
| `WINDOW_UPDATE` | Flow control                        |
| `RST_STREAM`    | Stream cancellation                 |
| `GOAWAY`        | Connection termination              |
| `PING`          | Keep-alive, timing attacks          |
| `PRIORITY`      | Stream prioritization               |

### HPACK Compression

```typescript
import { HpackEncoder, HpackDecoder } from "requestrr";

const encoder = new HpackEncoder();
const decoder = new HpackDecoder();

const compressed = encoder.encodeHeaders(
  new Map([
    [":method", "GET"],
    [":path", "/"],
  ])
);

const decoded = decoder.decodeHeaders(compressed);
```

---

## Utilities

### Timing Metrics

```typescript
const http = new HttpClient({ collectTiming: true });
const response = await http.fetch("https://example.com");

console.log(response.timing?.ttfb); // Time to first byte (ms)
console.log(response.timing?.totalDuration); // Total request time (ms)
console.log(response.timing?.connectionDuration);
```

### URL Encoding

```typescript
import { Encoder } from "requestrr";

Encoder.encode("../etc/passwd", "url"); // %2E%2E%2Fetc%2Fpasswd
Encoder.encode("../etc/passwd", "double-url"); // %252E%252E%252Fetc%252Fpasswd
Encoder.encode("<script>", "html-entity"); // &#x3c;script&#x3e;
Encoder.encode("test", "base64"); // dGVzdA==

// Path traversal variants for bypass testing
Encoder.pathTraversalVariants(3); // ["../../../", "..\\..\\..\\", "%2e%2e%2f...", ...]
```

### Request/Response Diffing

```typescript
import { Diff } from "requestrr";

const diff = Diff.compareResponses(response1, response2);
console.log(Diff.summarize(diff));

if (diff.timing?.ttfbDiff) {
  console.log(`TTFB difference: ${diff.timing.ttfbDiff}ms`);
}
```

### Connection Pooling

```typescript
import { ConnectionPool } from "requestrr";

const pool = new ConnectionPool({ maxConnectionsPerHost: 6 });
const conn = await pool.acquire("example.com", 80, "http");
// ... use connection ...
pool.release(conn);
pool.destroy();
```

### HTTP Pipelining

```typescript
const client = new RawHttp();
const responses = await client.sendPipelined({
  host: "example.com",
  port: 80,
  requests: [
    { method: "GET", path: "/page1" },
    { method: "GET", path: "/page2" },
  ],
});
```

### Proxy Support

```typescript
const response = await client.sendRequest({
  host: "target.com",
  port: 80,
  request: { method: "GET", path: "/" },
  proxy: {
    host: "proxy.example.com",
    port: 8080,
    auth: { username: "user", password: "pass" },
  },
});
```

### TLS Options

```typescript
const response = await http.raw({
  host: "secure.example.com",
  port: 443,
  protocol: "https",
  tls: {
    rejectUnauthorized: false, // Accept self-signed certs
    servername: "secure.example.com",
    minVersion: "TLSv1.2",
  },
  request: { method: "GET", path: "/" },
});
```

---

## Error Handling

```typescript
try {
  const response = await http.fetch("https://example.com", { timeout: 5000 });
} catch (error) {
  if (error.message.includes("timeout")) {
    console.error("Request timed out");
  } else if (error.message.includes("Connection")) {
    console.error("Connection failed");
  }
}
```

## License

MIT

## Disclaimer

For educational and authorized security testing only. Users must ensure proper authorization before testing any systems.
