import {
  ChevronDown,
  MessageSquare,
  SquareMousePointer,
  Type,
  X,
} from "lucide-react";
import * as React from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { Prompt, PromptTag } from "../../types.ts";

const TAG_ICON: Record<PromptTag, React.ReactNode> = {
  element: <SquareMousePointer className="size-3.5" />,
  text: <Type className="size-3.5" />,
  message: <MessageSquare className="size-3.5" />,
};

interface PendingChangesProps {
  queued: Prompt[];
  onRemove: (index: number) => void;
}

/**
 * Collapsible tray of point-and-click annotations awaiting a "Request changes"
 * send. Sits just above the composer.
 *
 * The open list is a fixed height (a little under three cards) and scrolls past
 * that, so the composer never shifts as annotations are queued or removed.
 *
 * Visual weight is deliberately light: a faint tint and thin accent border carry
 * presence, while the only saturated marks are a small dot and the count pill.
 */
export function PendingChanges({ queued, onRemove }: PendingChangesProps) {
  const [open, setOpen] = React.useState(true);

  if (queued.length === 0) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-md border border-primary/25 bg-primary/5"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left">
        <span className="flex items-center gap-2">
          <span
            className="size-1.5 shrink-0 rounded-full bg-primary"
            aria-hidden
          />
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Pending changes
          </span>
          <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-primary/20 bg-card px-1.5 py-px text-[12px] font-semibold leading-none text-primary">
            {queued.length}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex h-52 flex-col gap-1.5 overflow-y-auto border-t border-primary/15 p-2">
          {queued.map((p, i) => (
            <div
              key={p.uid}
              className="flex shrink-0 items-start gap-2 rounded-sm border border-border/70 bg-card px-2.5 py-1.5 text-sm"
            >
              <span className="mt-0.5 shrink-0 text-muted-foreground">
                {TAG_ICON[p.tag]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-4 break-words leading-snug">
                  {p.prompt}
                </div>
                {p.tag !== "message" && (
                  <div className="mt-0.5 line-clamp-2 break-words text-[13px] leading-snug text-muted-foreground">
                    {p.text ? `\u201c${p.text}\u201d` : p.selector}
                  </div>
                )}
              </div>
              <button
                type="button"
                aria-label="Remove"
                onClick={() => onRemove(i)}
                className="shrink-0 rounded text-muted-foreground/75 transition-colors hover:text-destructive"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
