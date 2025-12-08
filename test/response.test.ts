import { describe, expect, test } from "bun:test";
import { ResponseParser, ResponseAnalyzer } from "../src/response";

describe("ResponseParser", () => {
  test("parses a simple HTTP response", () => {
    const raw = Buffer.from(
      "HTTP/1.1 200 OK\r\n" +
        "Content-Type: text/plain\r\n" +
        "Content-Length: 5\r\n" +
        "\r\n" +
        "Hello"
    );

    const response = ResponseParser.parse(raw);

    expect(response.statusCode).toBe(200);
    expect(response.statusMessage).toBe("OK");
    expect(response.httpVersion).toBe("1.1");
    expect(response.body).toBe("Hello");
    expect(response.headers.get("content-type")).toEqual(["text/plain"]);
    expect(response.headers.get("content-length")).toEqual(["5"]);
  });

  test("parses response with LF-only line endings", () => {
    const raw = Buffer.from(
      "HTTP/1.1 200 OK\n" + "Content-Type: text/plain\n" + "\n" + "Body here"
    );

    const response = ResponseParser.parse(raw);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("Body here");
  });

  test("handles duplicate headers", () => {
    const raw = Buffer.from(
      "HTTP/1.1 200 OK\r\n" +
        "Set-Cookie: cookie1=value1\r\n" +
        "Set-Cookie: cookie2=value2\r\n" +
        "Set-Cookie: cookie3=value3\r\n" +
        "\r\n"
    );

    const response = ResponseParser.parse(raw);
    const cookies = response.headers.get("set-cookie");

    expect(cookies).toBeArray();
    expect(cookies?.length).toBe(3);
    expect(cookies).toContain("cookie1=value1");
    expect(cookies).toContain("cookie2=value2");
    expect(cookies).toContain("cookie3=value3");
  });

  test("parses various HTTP status codes", () => {
    const testCases = [
      { input: "HTTP/1.1 301 Moved Permanently\r\n\r\n", code: 301 },
      { input: "HTTP/1.1 404 Not Found\r\n\r\n", code: 404 },
      { input: "HTTP/1.1 500 Internal Server Error\r\n\r\n", code: 500 },
      { input: "HTTP/1.0 204 No Content\r\n\r\n", code: 204 },
    ];

    for (const tc of testCases) {
      const response = ResponseParser.parse(Buffer.from(tc.input));
      expect(response.statusCode).toBe(tc.code);
    }
  });

  test("handles malformed responses gracefully", () => {
    const raw = Buffer.from("not a valid http response");
    const response = ResponseParser.parse(raw);

    expect(response.parseError).toBeDefined();
    expect(response.statusCode).toBe(0);
  });

  test("handles response without body", () => {
    const raw = Buffer.from("HTTP/1.1 204 No Content\r\n\r\n");
    const response = ResponseParser.parse(raw);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
  });
});

describe("ResponseAnalyzer", () => {
  function createResponse(
    statusCode: number,
    headers: Record<string, string[]> = {},
    body: string = ""
  ) {
    const headerMap = new Map(Object.entries(headers));
    return new ResponseAnalyzer({
      raw: "",
      rawBuffer: Buffer.alloc(0),
      statusCode,
      statusMessage: "OK",
      httpVersion: "1.1",
      headers: headerMap,
      body,
      bodyBuffer: Buffer.from(body),
    });
  }

  describe("status checks", () => {
    test("identifies success status codes", () => {
      expect(createResponse(200).isSuccess()).toBe(true);
      expect(createResponse(201).isSuccess()).toBe(true);
      expect(createResponse(204).isSuccess()).toBe(true);
      expect(createResponse(299).isSuccess()).toBe(true);
      expect(createResponse(301).isSuccess()).toBe(false);
      expect(createResponse(404).isSuccess()).toBe(false);
    });

    test("identifies redirect status codes", () => {
      expect(createResponse(301).isRedirect()).toBe(true);
      expect(createResponse(302).isRedirect()).toBe(true);
      expect(createResponse(307).isRedirect()).toBe(true);
      expect(createResponse(200).isRedirect()).toBe(false);
    });

    test("identifies client error status codes", () => {
      expect(createResponse(400).isClientError()).toBe(true);
      expect(createResponse(404).isClientError()).toBe(true);
      expect(createResponse(403).isClientError()).toBe(true);
      expect(createResponse(500).isClientError()).toBe(false);
    });

    test("identifies server error status codes", () => {
      expect(createResponse(500).isServerError()).toBe(true);
      expect(createResponse(502).isServerError()).toBe(true);
      expect(createResponse(503).isServerError()).toBe(true);
      expect(createResponse(400).isServerError()).toBe(false);
    });

    test("checks specific status", () => {
      expect(createResponse(200).hasStatus(200)).toBe(true);
      expect(createResponse(200).hasStatus(201)).toBe(false);
    });

    test("checks status range", () => {
      expect(createResponse(200).hasStatusInRange(200, 299)).toBe(true);
      expect(createResponse(250).hasStatusInRange(200, 299)).toBe(true);
      expect(createResponse(300).hasStatusInRange(200, 299)).toBe(false);
    });
  });

  describe("body analysis", () => {
    test("checks if body contains string", () => {
      const analyzer = createResponse(200, {}, "Hello World");
      expect(analyzer.bodyContains("Hello")).toBe(true);
      expect(analyzer.bodyContains("world", false)).toBe(true); // case insensitive
      expect(analyzer.bodyContains("world", true)).toBe(false); // case sensitive
      expect(analyzer.bodyContains("notfound")).toBe(false);
    });

    test("checks if body matches pattern", () => {
      const analyzer = createResponse(200, {}, "User ID: 12345");
      expect(analyzer.bodyMatches(/\d+/)).toBe(true);
      expect(analyzer.bodyMatches(/User ID: \d+/)).toBe(true);
      expect(analyzer.bodyMatches(/^User/)).toBe(true);
      expect(analyzer.bodyMatches(/notfound/)).toBe(false);
    });
  });

  describe("header analysis", () => {
    test("checks if header exists", () => {
      const analyzer = createResponse(200, { "content-type": ["text/html"] });
      expect(analyzer.hasHeader("Content-Type")).toBe(true);
      expect(analyzer.hasHeader("content-type")).toBe(true);
      expect(analyzer.hasHeader("X-Missing")).toBe(false);
    });

    test("gets header values", () => {
      const analyzer = createResponse(200, {
        "content-type": ["application/json"],
        "set-cookie": ["a=1", "b=2"],
      });
      expect(analyzer.getHeader("Content-Type")).toEqual(["application/json"]);
      expect(analyzer.getHeader("Set-Cookie")).toEqual(["a=1", "b=2"]);
      expect(analyzer.getHeader("Missing")).toBeUndefined();
    });

    test("gets first header value", () => {
      const analyzer = createResponse(200, {
        "set-cookie": ["first", "second", "third"],
      });
      expect(analyzer.getFirstHeader("Set-Cookie")).toBe("first");
      expect(analyzer.getFirstHeader("Missing")).toBeUndefined();
    });

    test("checks header contains value", () => {
      const analyzer = createResponse(200, {
        "content-type": ["application/json; charset=utf-8"],
      });
      expect(analyzer.headerContains("Content-Type", "json")).toBe(true);
      expect(analyzer.headerContains("Content-Type", "utf-8")).toBe(true);
      expect(analyzer.headerContains("Content-Type", "xml")).toBe(false);
    });
  });

  describe("utility methods", () => {
    test("gets content type", () => {
      const analyzer = createResponse(200, {
        "content-type": ["application/json"],
      });
      expect(analyzer.getContentType()).toBe("application/json");
    });

    test("gets content length", () => {
      const analyzer = createResponse(200, { "content-length": ["42"] });
      expect(analyzer.getContentLength()).toBe(42);
    });

    test("parses cookies", () => {
      const analyzer = createResponse(200, {
        "set-cookie": ["session=abc123; Path=/", "user=john; HttpOnly"],
      });
      const cookies = analyzer.getCookies();
      expect(cookies.length).toBe(2);
    });
  });
});
