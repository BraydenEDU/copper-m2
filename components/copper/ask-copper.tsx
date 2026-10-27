"use client";

// Ask Copper: the floating chat panel. Tools on and tools off are two
// separate conversations, each sent with only its own history. Each answer
// streams in from the askCopper Server Action and is drawn as stations
// (see ask-copper-steps.tsx).
import { ArrowUp, MessageCircle } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Answer } from "@/components/copper/ask-copper-steps";
import { SetupRequired } from "@/components/setup-required";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { readLive } from "@/lib/ai/live";
import type { ChatMessage } from "@/lib/copper/assistant/ask";
import { askCopper } from "@/lib/copper/assistant/ask";
import type { Progress } from "@/lib/copper/assistant/progress";

const STARTERS = [
  "How much is Copper Home with Copper Plus, paid yearly, for 2 years?",
  "Is Copper Notes in Night Sky in stock?",
  "Is Copper Plus cheaper monthly or yearly?",
];

type Entry = { id: number; question: string; progress: Progress | null };
type Chats = { on: Entry[]; off: Entry[] };

let nextId = 1;

/** The turns sent to the model: finished questions and replies, in order. */
function historyOf(entries: Entry[]): ChatMessage[] {
  return entries.flatMap((entry): ChatMessage[] =>
    entry.progress?.status === "done"
      ? [
          { role: "user", content: entry.question },
          { role: "assistant", content: entry.progress.reply },
        ]
      : [],
  );
}

export function AskCopper({ aiConfigured }: { aiConfigured: boolean }) {
  const [open, setOpen] = useState(false);
  const [useTools, setUseTools] = useState(true);
  const [chats, setChats] = useState<Chats>({ on: [], off: [] });
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const key = useTools ? "on" : "off";
  const entries = chats[key];
  const streaming = entries.some(
    (entry) => !entry.progress || entry.progress.status === "working",
  );

  // The header link and /#ask open the panel. Listen for the click as well as
  // the hash, because clicking a link to the hash we're already on fires no
  // hashchange.
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === "#ask") setOpen(true);
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.(
        'a[href$="#ask"]',
      );
      if (link) setOpen(true);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      document.removeEventListener("click", onClick);
    };
  }, []);

  // Keep the newest step in view.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [chats, open]);

  function change(chat: keyof Chats, id: number, progress: Progress) {
    setChats((current) => ({
      ...current,
      [chat]: current[chat].map((entry) =>
        entry.id === id ? { ...entry, progress } : entry,
      ),
    }));
  }

  async function send(question: string) {
    const text = question.trim();
    if (!text || streaming) return;
    const chat = key;
    const id = nextId++;
    const messages: ChatMessage[] = [
      ...historyOf(chats[chat]),
      { role: "user", content: text },
    ];
    setInput("");
    setChats((current) => ({
      ...current,
      [chat]: [...current[chat], { id, question: text, progress: null }],
    }));
    try {
      const { progress } = await askCopper({
        messages,
        useTools: chat === "on",
      });
      for await (const update of readLive(progress)) change(chat, id, update);
    } catch {
      change(chat, id, {
        steps: [],
        reply: "Sorry, I couldn't answer that. Please try again.",
        status: "error",
      });
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next && window.location.hash === "#ask") {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="ask-copper-launcher"
        onClick={() => setOpen(true)}
        className="bg-primary text-primary-foreground focus-visible:ring-ring fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold shadow-lg transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:outline-none"
      >
        <MessageCircle className="size-5" aria-hidden />
        Ask Copper
      </button>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          data-testid="ask-copper"
          side="right"
          className="w-full gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="bg-chart-5 gap-0 p-0 text-white">
            <div className="flex items-center gap-3 p-4 pr-12">
              <span className="bg-primary relative size-10 shrink-0 overflow-hidden rounded-full">
                <Image
                  src="/assets/brand/copper-mascot.png"
                  alt="Copper, the Copper State Labs mascot"
                  fill
                  sizes="40px"
                  className="object-contain p-1"
                />
              </span>
              <div>
                <SheetTitle className="text-lg text-white">
                  Ask Copper
                </SheetTitle>
                <SheetDescription className="text-xs text-white/80">
                  Prices, totals and stock, checked with tools.
                </SheetDescription>
              </div>
            </div>
            <div className="flex items-center justify-between bg-white/10 px-4 py-2">
              <div>
                <p className="text-sm font-medium">Use tools</p>
                <p className="text-xs text-white/80">
                  {useTools ? "Checks every answer" : "Model guesses alone"}
                </p>
              </div>
              <Switch
                aria-label="Use tools"
                checked={useTools}
                onCheckedChange={setUseTools}
              />
            </div>
          </SheetHeader>

          {aiConfigured ? (
            <>
              <div
                ref={bodyRef}
                className="bg-secondary flex-1 space-y-6 overflow-y-auto p-4"
              >
                {entries.map((entry) => (
                  <div key={entry.id} className="space-y-3">
                    <p className="bg-primary text-primary-foreground ml-auto w-fit max-w-[85%] rounded-xl rounded-br-none px-3 py-2 text-sm">
                      {entry.question}
                    </p>
                    <Answer progress={entry.progress} useTools={useTools} />
                  </div>
                ))}
                {!streaming && (
                  <div className="flex flex-col items-start gap-2">
                    {STARTERS.map((starter) => (
                      <Button
                        key={starter}
                        type="button"
                        variant="outline"
                        className="h-auto whitespace-normal py-2 text-left"
                        onClick={() => send(starter)}
                      >
                        {starter}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              <form
                className="bg-background flex items-center gap-2 border-t p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(input);
                }}
              >
                <Input
                  aria-label="Your question"
                  placeholder="Ask about prices or stock"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  className="rounded-full"
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send"
                  disabled={streaming}
                  className="rounded-full"
                >
                  <ArrowUp className="size-4" />
                </Button>
              </form>
            </>
          ) : (
            <div className="bg-secondary flex-1 overflow-y-auto p-4">
              <SetupRequired service="ai" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
