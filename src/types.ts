// Shared contract types between the CLI, server, chrome UI, and injected SDK.

/** A single piece of point-and-click feedback the user queued in the browser. */
export interface Prompt {
  /** Session-scoped unique id assigned by the SDK. */
  uid: string;
  /** The user's note. */
  prompt: string;
  /** Stable CSS selector of the annotated element (empty for freeform messages). */
  selector: string;
  /** Annotation kind: "element", "text", or "message". */
  tag: PromptTag;
  /** Short human label / captured element or selection text. */
  text: string;
  /** Structured target metadata (element uid, text-range anchors, etc). */
  target: PromptTarget | null;
}

export type PromptTag = "element" | "text" | "message";

export interface ElementTarget {
  type: "element";
  uid: string;
  selector: string;
  tag: string; // dom tag name
  text: string;
}

export interface TextRangeBoundary {
  selector: string;
  path: number[];
  offset: number;
}

export interface TextRangeTarget {
  type: "text-range";
  selector: string;
  text: string;
  start: TextRangeBoundary;
  end: TextRangeBoundary;
}

export type PromptTarget = ElementTarget | TextRangeTarget;

export type ReviewStatus = "queued" | "working" | "addressed";

/** A batch of requested changes the reviewer submitted with one "Make changes". */
export interface Review {
  /** Session-scoped unique id. */
  id: string;
  /** The requested changes in this batch. */
  comments: Prompt[];
  /** Lifecycle: queued (awaiting poll) -> working (agent drained) -> addressed. */
  status: ReviewStatus;
  /** Agent's summary, set once the review is addressed. */
  reply: string | null;
  submittedAt: number;
  addressedAt: number | null;
}

export type Presence = "waiting" | "listening" | "working" | "ended";

/** Persisted per-session state. */
export interface SessionState {
  key: string;
  file: string; // canonical absolute path to the artifact
  title: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  reviews: Review[];
  /** Feedback queued by the browser and not yet drained by an agent poll. */
  pending: Prompt[];
  /** True once feedback has been delivered to an agent that has not yet replied. */
  awaitingReply: boolean;
  ended: boolean;
  endedBy: "user" | "agent" | null;
}

/** Bootstrap payload returned by GET /api/:key/state. */
export interface StatePayload {
  key: string;
  file: string;
  title: string;
  reviews: Review[];
  revision: number;
  presence: Presence;
  ended: boolean;
  endedBy: "user" | "agent" | null;
  token: string;
  modeToggleHotkeyKey: string;
}

/** Response of GET /api/poll. */
export type PollResponse =
  | { status: "feedback"; prompts: Prompt[]; file: string; revision: number }
  | { status: "ended"; endedBy: "user" | "agent" | null; file: string }
  | { status: "timeout" };

// ---- postMessage contract (artifact SDK <-> chrome) --------------------------

/** Messages the injected SDK posts up to the chrome parent frame. */
export type SdkToChrome =
  | { type: "critique:ready"; token: string }
  | { type: "critique:queuePrompt"; token: string; prompt: Prompt }
  | { type: "critique:sendQueued"; token: string }
  | { type: "critique:end"; token: string }
  | { type: "critique:scroll"; token: string; x: number; y: number }
  | { type: "critique:reviewState"; token: string; state: ReviewState }
  | { type: "critique:toggleMode"; token: string };

/** UI theme selection shared by the chrome and the injected card UI. */
export type Theme = "system" | "light" | "dark";

/** Messages the chrome posts down into the artifact iframe. */
export type ChromeToSdk =
  | { type: "critique:setMode"; enabled: boolean }
  | { type: "critique:setTheme"; theme: Theme }
  | { type: "critique:restoreScroll"; x: number; y: number }
  | { type: "critique:restoreReviewState"; state: ReviewState | null }
  | { type: "critique:reveal"; selector: string };

/** In-progress annotation card text preserved across live reloads. */
export interface ReviewState {
  card: { selector: string; text: string } | null;
}
