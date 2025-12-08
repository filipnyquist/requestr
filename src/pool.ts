/**
 * httpforger - Connection Pool for Keep-Alive Connections
 */

import type { TLSOptions, PooledConnection } from "./types";

export class ConnectionPool {
  private connections: Map<string, PooledConnection[]> = new Map();
  private maxConnectionsPerHost: number;
  private connectionTimeout: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options?: {
    maxConnectionsPerHost?: number;
    connectionTimeout?: number;
  }) {
    this.maxConnectionsPerHost = options?.maxConnectionsPerHost ?? 6;
    this.connectionTimeout = options?.connectionTimeout ?? 30000;
    this.startCleanup();
  }

  private getKey(host: string, port: number, protocol: string): string {
    return `${protocol}://${host}:${port}`;
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, conns] of this.connections) {
        const active = conns.filter((c) => {
          if (!c.inUse && now - c.lastUsed > this.connectionTimeout) {
            try {
              c.socket.end();
            } catch {
              // Ignore
            }
            return false;
          }
          return true;
        });
        if (active.length === 0) {
          this.connections.delete(key);
        } else {
          this.connections.set(key, active);
        }
      }
    }, 10000);
  }

  /**
   * Get or create a connection from the pool
   */
  async acquire(
    host: string,
    port: number,
    protocol: "http" | "https",
    tls?: TLSOptions
  ): Promise<PooledConnection> {
    const key = this.getKey(host, port, protocol);
    const conns = this.connections.get(key) || [];

    // Try to find an available connection
    const available = conns.find((c) => !c.inUse);
    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();
      return available;
    }

    // Create new connection if under limit
    if (conns.length < this.maxConnectionsPerHost) {
      const socketConfig = {
        hostname: host,
        port,
        socket: {
          open() {},
          data() {},
          close() {},
          error() {},
          end() {},
        },
      };

      let socket: PooledConnection["socket"];
      if (protocol === "https") {
        socket = await Bun.connect({
          ...socketConfig,
          tls: {
            rejectUnauthorized: tls?.rejectUnauthorized ?? false,
            serverName: tls?.servername ?? host,
            ...tls,
          } as Parameters<typeof Bun.connect>[0]["tls"],
        });
      } else {
        socket = await Bun.connect(socketConfig);
      }

      const conn: PooledConnection = {
        socket,
        host,
        port,
        protocol,
        lastUsed: Date.now(),
        inUse: true,
      };

      conns.push(conn);
      this.connections.set(key, conns);
      return conn;
    }

    // Wait for a connection to become available
    return new Promise((resolve) => {
      const check = setInterval(() => {
        const available = conns.find((c) => !c.inUse);
        if (available) {
          clearInterval(check);
          available.inUse = true;
          available.lastUsed = Date.now();
          resolve(available);
        }
      }, 100);
    });
  }

  /**
   * Release a connection back to the pool
   */
  release(conn: PooledConnection): void {
    conn.inUse = false;
    conn.lastUsed = Date.now();
  }

  /**
   * Close all connections and stop cleanup
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    for (const conns of this.connections.values()) {
      for (const conn of conns) {
        try {
          conn.socket.end();
        } catch {
          // Ignore
        }
      }
    }
    this.connections.clear();
  }

  /**
   * Get pool statistics
   */
  stats(): {
    totalConnections: number;
    activeConnections: number;
    hosts: number;
  } {
    let total = 0;
    let active = 0;
    for (const conns of this.connections.values()) {
      total += conns.length;
      active += conns.filter((c) => c.inUse).length;
    }
    return {
      totalConnections: total,
      activeConnections: active,
      hosts: this.connections.size,
    };
  }
}
