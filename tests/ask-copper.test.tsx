import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLive, finalValue, readLive } from "@/lib/ai/live";
import type { Progress } from "@/lib/copper/assistant/progress";

let parts: unknown[] | (() => AsyncGenerator<unknown>) = [];

vi.mock("@/lib/ai/call", () => ({
  THOUGHT_SUMMARIES: {},
  isAiConfigured: () => true,
  callStream: () => ({
    fullStream: (async function* () {
      if (typeof parts === "function") yield* parts();
      else yield* parts;
    })(),
  }),
}));

const question = [{ role: "user" as const, content: "Hi" }];

describe("askCopper edge cases", () => {
  it("is done with an apology when the model says nothing", async () => {
    parts = [];
    const { askCopper } = await import("@/lib/copper/assistant/ask");
    const result = await finalValue(
      (await askCopper({ messages: question, useTools: true })).progress,
    );
    expect(result).toMatchObject({ status: "done" });
    expect(result.reply).toMatch(/sorry/i);
  });

  it("ends in error, keeping a real reply, when the stream throws", async () => {
    parts = async function* () {
      yield { type: "text-delta", text: "Copper Home is" };
      throw new Error("boom");
    };
    const { askCopper } = await import("@/lib/copper/assistant/ask");
    const result = await finalValue(
      (await askCopper({ messages: question, useTools: false })).progress,
    );
    expect(result).toMatchObject({ status: "error", reply: "Copper Home is" });
  });

  it("puts a tool error in the step's output", async () => {
    parts = [
      { type: "tool-input-start", id: "c1", toolName: "calculate_cost" },
      { type: "tool-error", toolCallId: "c1", error: new Error("bad input") },
    ];
    const { askCopper } = await import("@/lib/copper/assistant/ask");
    const result = await finalValue(
      (await askCopper({ messages: question, useTools: true })).progress,
    );
    expect(result.steps[0]).toMatchObject({
      state: "error",
      output: "bad input",
    });
  });

  it("hands out copies, so earlier updates never change", async () => {
    parts = [
      { type: "text-delta", text: "A" },
      { type: "text-delta", text: "B" },
    ];
    const { askCopper } = await import("@/lib/copper/assistant/ask");
    const updates: Progress[] = [];
    for await (const u of readLive(
      (await askCopper({ messages: question, useTools: false })).progress,
    )) {
      updates.push(u);
    }
    expect(updates.map((u) => u.reply)).toEqual(["A", "AB", "AB"]);
  });
});

describe("the Ask Copper panel", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.doUnmock("@/lib/copper/assistant/ask");
  });

  async function openPanel(askCopper: unknown) {
    vi.doMock("@/lib/copper/assistant/ask", () => ({ askCopper }));
    const { AskCopper } = await import("@/components/copper/ask-copper");
    render(<AskCopper aiConfigured />);
    fireEvent.click(screen.getByTestId("ask-copper-launcher"));
    return within(await screen.findByTestId("ask-copper"));
  }

  it("hides the starter questions only while an answer streams", async () => {
    const pending = createLive<Progress>();
    const chat = await openPanel(
      vi.fn().mockResolvedValue({ progress: pending.live }),
    );
    const starter = "Is Copper Notes in Night Sky in stock?";
    fireEvent.click(chat.getByRole("button", { name: starter }));
    await waitFor(() =>
      expect(chat.queryByRole("button", { name: starter })).toBeNull(),
    );
    pending.done({ steps: [], reply: "Sold out.", status: "done" });
    expect(
      await chat.findByRole("button", { name: starter }),
    ).toBeInTheDocument();
  });

  it("shows stock as pills, with the back-order date", async () => {
    const done = createLive<Progress>();
    done.done({
      reply: "Night Sky is back-ordered.",
      status: "done",
      steps: [
        {
          type: "tool",
          id: "c1",
          name: "check_availability",
          state: "done",
          input: { product: "copper-notes", color: "Night Sky" },
          output: {
            status: "ok",
            product: "Copper Notes",
            colors: [
              {
                color: "Night Sky",
                stock: "backordered",
                restockDate: "2026-11-14",
              },
            ],
          },
        },
      ],
    });
    const chat = await openPanel(
      vi.fn().mockResolvedValue({ progress: done.live }),
    );
    fireEvent.change(chat.getByRole("textbox"), {
      target: { value: "Night Sky?" },
    });
    fireEvent.click(chat.getByRole("button", { name: /send/i }));
    expect(
      await chat.findByText(/back-ordered until Nov 14, 2026/i),
    ).toBeInTheDocument();
  });

  it("shows an apology when the action itself fails", async () => {
    const chat = await openPanel(vi.fn().mockRejectedValue(new Error("down")));
    fireEvent.change(chat.getByRole("textbox"), {
      target: { value: "Hello?" },
    });
    fireEvent.click(chat.getByRole("button", { name: /send/i }));
    expect(await chat.findByText(/couldn't answer that/i)).toBeInTheDocument();
  });
});
