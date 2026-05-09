import { describe, expect, test, vi, beforeEach } from "vitest";
import { GatewayClient } from "./gateway";

describe("GatewayClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("attaches Bearer token to requests", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify([]), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const client = new GatewayClient("http://127.0.0.1:1234", "tok");
    await client.listProjects();

    expect(fetchSpy).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const init = (fetchSpy.mock.calls[0] as unknown as any[])[1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  test("listProjects returns parsed array", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify([{ id: "p1", name: "x", root_path: "/a" }]), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    const client = new GatewayClient("http://127.0.0.1:1234", "tok");
    const items = await client.listProjects();
    expect(items.map((p) => p.id)).toEqual(["p1"]);
  });

  test("createProject POSTs name + root_path", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ id: "new", name: "my", root_path: "/r" }), {
        status: 201,
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const client = new GatewayClient("http://127.0.0.1:1234", "tok");
    const created = await client.createProject({ name: "my", root_path: "/r" });

    expect(created.id).toBe("new");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const init = (fetchSpy.mock.calls[0] as unknown as any[])[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "my",
      root_path: "/r",
    });
  });

  test("throws on non-2xx with the response body in the message", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ detail: "bad root" }), { status: 400 }),
    ) as unknown as typeof fetch;

    const client = new GatewayClient("http://127.0.0.1:1234", "tok");
    await expect(
      client.createProject({ name: "x", root_path: "/nope" }),
    ).rejects.toThrow(/bad root/);
  });
});
