import { describe, expect, test } from "bun:test";
import { RequestBuilder } from "../src/builder";

describe("RequestBuilder", () => {
  describe("basic request building", () => {
    test("builds a simple GET request", () => {
      const request = new RequestBuilder()
        .method("GET")
        .path("/api/users")
        .header("Host", "example.com")
        .build();

      expect(request).toContain("GET /api/users HTTP/1.1");
      expect(request).toContain("Host: example.com");
    });

    test("builds a POST request with body", () => {
      const request = new RequestBuilder()
        .method("POST")
        .path("/api/users")
        .header("Host", "example.com")
        .header("Content-Type", "application/json")
        .body('{"name":"test"}')
        .build();

      expect(request).toContain("POST /api/users HTTP/1.1");
      expect(request).toContain("Content-Type: application/json");
      expect(request).toContain('{"name":"test"}');
    });

    test("builds request with JSON body helper", () => {
      const request = new RequestBuilder()
        .method("POST")
        .path("/api/data")
        .header("Host", "example.com")
        .jsonBody({ key: "value", nested: { a: 1 } })
        .build();

      expect(request).toContain("Content-Type: application/json");
      expect(request).toContain('{"key":"value","nested":{"a":1}}');
    });
  });

  describe("URL parsing", () => {
    test("parses URL and extracts components", () => {
      const builder = new RequestBuilder().url(
        "https://api.example.com:8443/path?query=1"
      );

      const options = builder.buildOptions();
      expect(options.path).toBe("/path?query=1");
    });

    test("builds fetch init from URL", () => {
      const init = new RequestBuilder()
        .url("https://api.example.com/data")
        .method("POST")
        .header("X-Custom", "value")
        .body("test body")
        .buildFetchInit();

      expect(init.method).toBe("POST");
      expect(init.headers.get("X-Custom")).toBe("value");
      expect(init.body).toBe("test body");
    });
  });

  describe("HTTP versions", () => {
    test("defaults to HTTP/1.1", () => {
      const request = new RequestBuilder()
        .method("GET")
        .path("/")
        .header("Host", "example.com")
        .build();

      expect(request).toContain("HTTP/1.1");
    });

    test("can set HTTP/1.0", () => {
      const request = new RequestBuilder()
        .method("GET")
        .path("/")
        .header("Host", "example.com")
        .httpVersion("1.0")
        .build();

      expect(request).toContain("HTTP/1.0");
    });
  });

  describe("headers", () => {
    test("adds multiple headers", () => {
      const request = new RequestBuilder()
        .method("GET")
        .path("/")
        .headers({
          Host: "example.com",
          "User-Agent": "test",
          Accept: "application/json",
        })
        .build();

      expect(request).toContain("Host: example.com");
      expect(request).toContain("User-Agent: test");
      expect(request).toContain("Accept: application/json");
    });

    test("handles duplicate headers", () => {
      const request = new RequestBuilder()
        .method("GET")
        .path("/")
        .header("Host", "example.com")
        .duplicateHeader("X-Custom", ["value1", "value2", "value3"])
        .build();

      const matches = request.match(/X-Custom:/g);
      expect(matches?.length).toBe(3);
    });

    test("adds raw header line", () => {
      const request = new RequestBuilder()
        .method("GET")
        .path("/")
        .header("Host", "example.com")
        .rawHeader("X-Raw-Header: raw value here")
        .build();

      expect(request).toContain("X-Raw-Header: raw value here");
    });
  });

  describe("connection options", () => {
    test("extracts connection options from URL", () => {
      const builder = new RequestBuilder().url("https://secure.example.com/api");

      const options = builder.getConnectionOptions();
      expect(options.host).toBe("secure.example.com");
      expect(options.port).toBe(443);
      expect(options.protocol).toBe("https");
    });

    test("extracts connection options from host/port/scheme", () => {
      const builder = new RequestBuilder()
        .host("api.test.com")
        .port(8080)
        .scheme("http");

      const options = builder.getConnectionOptions();
      expect(options.host).toBe("api.test.com");
      expect(options.port).toBe(8080);
      expect(options.protocol).toBe("http");
    });
  });
});
