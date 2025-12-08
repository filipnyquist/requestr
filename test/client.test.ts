import { describe, expect, test } from "bun:test";
import { RawHttp } from "../src/client";

describe("RawHttp", () => {
  describe("static methods", () => {
    test("creates RequestBuilder via static method", () => {
      const builder = RawHttp.request();
      expect(builder).toBeDefined();
      expect(typeof builder.method).toBe("function");
      expect(typeof builder.path).toBe("function");
      expect(typeof builder.header).toBe("function");
      expect(typeof builder.build).toBe("function");
    });
  });

  describe("smuggling helpers", () => {
    test("builds CL.TE smuggling request", () => {
      const request = RawHttp.smugglingCLTE({
        host: "target.com",
        path: "/",
        contentLength: 6,
        body: "0\r\n\r\nG",
      });

      expect(request).toContain("Content-Length: 6");
      expect(request).toContain("Transfer-Encoding: chunked");
      expect(request).toContain("0\r\n\r\nG");
    });

    test("builds TE.CL smuggling request", () => {
      const request = RawHttp.smugglingTECL({
        host: "target.com",
        path: "/",
        contentLength: 4,
        body: "test body",
      });

      expect(request).toContain("Transfer-Encoding: chunked");
      expect(request).toContain("Content-Length: 4");
    });
  });

  describe("obfuscation helpers", () => {
    test("builds obfuscated Transfer-Encoding header", () => {
      const request = RawHttp.obfuscatedTransferEncoding({
        host: "target.com",
        obfuscation: "tab",
        body: "0\r\n\r\n",
      });

      expect(request).toContain("Transfer-Encoding");
      expect(request).toContain("chunked");
    });

    test("builds CRLF injection request", () => {
      const request = RawHttp.crlfInjection({
        host: "target.com",
        headerName: "X-Custom",
        headerValue: "legitimate",
        injectedHeaders: "X-Injected: yes",
      });

      expect(request).toContain("X-Custom");
      expect(request).toContain("X-Injected: yes");
    });
  });

  describe("host header attacks", () => {
    test("builds duplicate host header attack", () => {
      const request = RawHttp.hostHeaderAttack({
        legitimateHost: "target.com",
        attackHost: "evil.com",
        attackType: "duplicate",
      });

      const hostMatches = request.match(/Host:/gi);
      expect(hostMatches?.length).toBe(2);
      expect(request).toContain("target.com");
      expect(request).toContain("evil.com");
    });

    test("builds host override attack", () => {
      const request = RawHttp.hostHeaderAttack({
        legitimateHost: "target.com",
        attackHost: "evil.com",
        attackType: "override",
      });

      expect(request).toContain("X-Forwarded-Host: evil.com");
    });
  });

  describe("null byte injection", () => {
    test("injects null byte in path", () => {
      const request = RawHttp.nullByteInjection({
        host: "target.com",
        path: "/admin",
        inPath: true,
      });

      expect(request).toContain("/admin\x00");
    });

    test("injects null byte in header", () => {
      const request = RawHttp.nullByteInjection({
        host: "target.com",
        inHeader: { name: "X-Test", value: "before" },
      });

      expect(request).toContain("X-Test: before\x00");
    });
  });

  describe("method override", () => {
    test("builds method override request", () => {
      const request = RawHttp.methodOverride({
        host: "target.com",
        actualMethod: "POST",
        overrideMethod: "DELETE",
      });

      expect(request).toContain("POST");
      expect(request).toContain("X-HTTP-Method-Override: DELETE");
    });
  });

  describe("duplicate headers", () => {
    test("builds request with duplicate headers", () => {
      const request = RawHttp.duplicateHeaders({
        host: "target.com",
        headerName: "Content-Length",
        values: ["100", "50", "25"],
      });

      const clMatches = request.match(/Content-Length:/g);
      expect(clMatches?.length).toBe(3);
    });
  });

  describe("chunked encoding", () => {
    test("creates chunked body", () => {
      const body = RawHttp.createChunkedBody([
        { data: "Hello" },
        { data: "World" },
      ]);

      expect(body).toContain("5\r\nHello\r\n");
      expect(body).toContain("5\r\nWorld\r\n");
      expect(body).toContain("0\r\n\r\n"); // terminator
    });

    test("creates malformed chunked body", () => {
      const body = RawHttp.createChunkedBody([
        { data: "Test", malformed: true },
      ]);

      expect(body).toBeDefined();
      // Malformed chunks include extensions
      expect(body.length).toBeGreaterThan(0);
    });
  });

  describe("special requests", () => {
    test("creates HTTP/0.9 request", () => {
      const request = RawHttp.http09Request("/index.html");
      expect(request).toBe("GET /index.html\r\n");
    });

    test("creates oversized header", () => {
      const request = RawHttp.oversizedHeader({
        host: "target.com",
        headerName: "X-Large",
        size: 1000,
      });

      expect(request).toContain("X-Large:");
      // Header value should be approximately the requested size
      const headerMatch = request.match(/X-Large: ([A-Z]+)/);
      expect(headerMatch?.[1]?.length).toBe(1000);
    });

    test("creates absolute URI request", () => {
      const request = RawHttp.absoluteURI({
        host: "target.com",
        port: 80,
        path: "/api/data",
      });

      expect(request).toContain("GET http://target.com/api/data HTTP/1.1");
    });
  });
});
