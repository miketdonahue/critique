import * as React from "react";
import { Loader2, MessageSquareDashed } from "lucide-react";
import { Markdown } from "./Markdown.tsx";
import type { Prompt, Review } from "../../types.ts";

/**
 * One type scale for every turn in the transcript. Both the reviewer's bubble
 * and the agent's Markdown prose use it, so neither speaker's text differs in
 * size or leading from the other.
 */
const TURN_TYPE = "text-sm leading-relaxed";

function ChangeCard({ p }: { p: Prompt }) {
  const anchor = `${p.tag === "text" ? "text" : "element"}: ${
    p.text ? `\u201c${p.text}\u201d` : p.selector
  }`;
  return (
    <div className={`rounded-md border border-border bg-card px-3 py-2 ${TURN_TYPE}`}>
      <div className="font-medium">{p.prompt}</div>
      {p.tag !== "message" && (
        <div className="truncate text-[13px] text-muted-foreground" title={anchor}>
          {anchor}
        </div>
      )}
    </div>
  );
}

/**
 * The reviewer's turn. A chat message renders as a soft neutral bubble aligned
 * right; a batch of annotations renders as labelled change cards.
 */
function UserTurn({ review }: { review: Review }) {
  const isMessage = review.comments.every((c) => c.tag === "message");
  if (isMessage) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {review.comments.map((c) => (
          <div
            key={c.uid}
            className={`max-w-[88%] whitespace-pre-wrap rounded-xl bg-bubble-user px-3 py-2 text-bubble-user-foreground ${TURN_TYPE}`}
          >
            {c.prompt}
          </div>
        ))}
      </div>
    );
  }
  const count = review.comments.length;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        Requested {count} change{count === 1 ? "" : "s"}
      </span>
      {review.comments.map((c) => (
        <ChangeCard key={c.uid} p={c} />
      ))}
    </div>
  );
}

/**
 * The agent's turn: plain prose on the panel surface, with no bubble or tint.
 * Alignment and containment alone distinguish the two speakers.
 */
function AgentTurn({ review }: { review: Review }) {
  if (review.status === "addressed" && review.reply) {
    return <Markdown className={`px-0.5 ${TURN_TYPE}`}>{review.reply}</Markdown>;
  }
  return (
    <div className={`flex items-center gap-2 px-0.5 text-muted-foreground ${TURN_TYPE}`}>
      <Loader2 className="size-3.5 animate-spin" />
      Working...
    </div>
  );
}

interface TranscriptProps {
  reviews: Review[];
}

export function Transcript({ reviews }: TranscriptProps) {
  if (reviews.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <MessageSquareDashed className="size-10 text-muted-foreground/50" />
        <p className={`text-muted-foreground ${TURN_TYPE}`}>
          Annotate or send a message to begin.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {reviews.map((review) => (
        <div key={review.id} className="flex flex-col gap-2.5">
          <UserTurn review={review} />
          <AgentTurn review={review} />
        </div>
      ))}
    </div>
  );
}
