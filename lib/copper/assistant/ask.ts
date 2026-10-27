"use server";

// Module 2: the server action the Ask Copper chat calls. It streams the
// conversation to the model through callStream (lib/ai/call.ts), with or
// without the tools, and sends back each step as it happens, so the panel can
// show Copper thinking and using its tools. The contract is in
// specs/module-2/spec.md.
import { stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive } from "@/lib/ai/live";
import type { Live } from "@/lib/ai/live";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import type { Progress, ToolStep } from "@/lib/copper/assistant/progress";
import { copperTools } from "@/lib/copper/assistant/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per question. */
const MAX_STEPS = 5;

const SORRY = "Sorry, I couldn't answer that. Please try again.";

/** A copy of the progress that later changes can't reach. */
function snapshot(progress: Progress): Progress {
  return {
    ...progress,
    steps: progress.steps.map((step) => ({ ...step })),
  };
}

export async function askCopper(
  request: AskCopperRequest,
): Promise<AskCopperResult> {
  const messages = request.messages.map(({ role, content }) => ({
    role,
    content,
  }));
  const useTools = request.useTools === true;
  const { live, update, done } = createLive<Progress>();
  const progress: Progress = { steps: [], reply: "", status: "working" };

  // Read the stream in the background so the panel gets the live value now.
  void (async () => {
    try {
      const result = callStream(
        { module: 2, feature: "ask-copper" },
        {
          messages,
          providerOptions: THOUGHT_SUMMARIES,
          // With tools off there are no instructions and no tools at all.
          ...(useTools
            ? {
                instructions: COPPER_INSTRUCTIONS,
                tools: copperTools,
                stopWhen: stepCountIs(MAX_STEPS),
              }
            : {}),
        },
      );

      const toolStep = (id: string) =>
        progress.steps.find(
          (step): step is ToolStep => step.type === "tool" && step.id === id,
        );

      for await (const part of result.fullStream) {
        if (part.type === "reasoning-delta") {
          const last = progress.steps.at(-1);
          if (last?.type === "thinking") last.text += part.text;
          else progress.steps.push({ type: "thinking", text: part.text });
        } else if (part.type === "tool-input-start") {
          progress.steps.push({
            type: "tool",
            id: part.id,
            name: part.toolName,
            state: "calling",
          });
        } else if (part.type === "tool-call") {
          const step = toolStep(part.toolCallId);
          if (step) step.input = part.input;
          else
            progress.steps.push({
              type: "tool",
              id: part.toolCallId,
              name: part.toolName,
              state: "calling",
              input: part.input,
            });
        } else if (part.type === "tool-result") {
          const step = toolStep(part.toolCallId);
          if (step) {
            step.output = part.output;
            step.state = "done";
          }
        } else if (part.type === "tool-error") {
          const step = toolStep(part.toolCallId);
          if (step) {
            step.output =
              part.error instanceof Error
                ? part.error.message
                : String(part.error);
            step.state = "error";
          }
        } else if (part.type === "text-delta") {
          progress.reply += part.text;
        } else if (part.type === "error") {
          throw part.error;
        } else {
          continue;
        }
        update(snapshot(progress));
      }

      // A stream that ends normally with nothing to say is still "done".
      if (progress.reply === "") progress.reply = SORRY;
      progress.status = "done";
      done(snapshot(progress));
    } catch {
      progress.status = "error";
      if (progress.reply === "") progress.reply = SORRY;
      done(snapshot(progress));
    }
  })();

  return { progress: live };
}
