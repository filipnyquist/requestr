import { describe, expect, test } from "bun:test";
import { Encoder } from "../src/encoder";

describe("Encoder", () => {
  describe("URL encoding", () => {
    test("encodes special characters", () => {
      expect(Encoder.encode("hello world", "url")).toBe("hello%20world");
      expect(Encoder.encode("a=b&c=d", "url")).toBe("a%3Db%26c%3Dd");
      expect(Encoder.encode("../etc/passwd", "url")).toBe("..%2Fetc%2Fpasswd");
    });

    test("double URL encodes", () => {
      expect(Encoder.encode("../", "double-url")).toBe("..%252F");
      expect(Encoder.encode("a=b", "double-url")).toBe("a%253Db");
    });

    test("URL encodes all characters", () => {
      expect(Encoder.urlEncodeAll("abc")).toBe("%61%62%63");
      expect(Encoder.urlEncodeAll("../")).toBe("%2E%2E%2F");
    });
  });

  describe("Unicode encoding", () => {
    test("encodes to unicode escape sequences", () => {
      expect(Encoder.encode("abc", "unicode")).toBe("\\u0061\\u0062\\u0063");
      expect(Encoder.encode("A", "unicode")).toBe("\\u0041");
    });
  });

  describe("Hex encoding", () => {
    test("encodes to hex escape sequences", () => {
      expect(Encoder.encode("abc", "hex")).toBe("\\x61\\x62\\x63");
      expect(Encoder.encode("AB", "hex")).toBe("\\x41\\x42");
    });
  });

  describe("Octal encoding", () => {
    test("encodes to octal escape sequences", () => {
      expect(Encoder.encode("A", "octal")).toBe("\\101");
      expect(Encoder.encode("abc", "octal")).toBe("\\141\\142\\143");
    });
  });

  describe("Base64 encoding", () => {
    test("encodes to base64", () => {
      expect(Encoder.encode("hello", "base64")).toBe("aGVsbG8=");
      expect(Encoder.encode("test", "base64")).toBe("dGVzdA==");
    });

    test("decodes from base64", () => {
      expect(Encoder.decode("aGVsbG8=", "base64")).toBe("hello");
      expect(Encoder.decode("dGVzdA==", "base64")).toBe("test");
    });
  });

  describe("HTML entity encoding", () => {
    test("encodes to HTML entities", () => {
      const encoded = Encoder.encode("<script>", "html-entity");
      expect(encoded).toContain("&#x3c;");
      expect(encoded).toContain("&#x3e;");
    });
  });

  describe("Path traversal helpers", () => {
    test("generates path traversal sequences", () => {
      expect(Encoder.pathTraversal(1)).toBe("../");
      expect(Encoder.pathTraversal(3)).toBe("../../../");
    });

    test("generates URL-encoded path traversal", () => {
      expect(Encoder.pathTraversal(1, "url")).toBe("..%2F");
      expect(Encoder.pathTraversal(2, "url")).toBe("..%2F..%2F");
    });

    test("generates path traversal variants", () => {
      const variants = Encoder.pathTraversalVariants(1);
      expect(variants).toBeArray();
      expect(variants.length).toBeGreaterThan(1);
      expect(variants).toContain("../");
      expect(variants).toContain("..\\");
    });
  });

  describe("Mixed encoding", () => {
    test("applies mixed encodings", () => {
      // Use a longer string to reduce chance of all chars being unencoded
      const result = Encoder.mixedEncode("abcdefgh", ["url", "unicode", "hex"]);
      // Result should be defined and non-empty
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
