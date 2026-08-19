import { Check, CircleOff, Copy } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  ChromeToSdk,
  Presence,
  Prompt,
  Review,
  ReviewState,
  SdkToChrome,
  StatePayload,
  Theme,
} from "../types.ts";
import { PendingChanges } from "./components/PendingChanges.tsx";
import { SettingsMenu } from "./components/SettingsMenu.tsx";
import { Transcript } from "./components/Transcript.tsx";

// Module-level constants (computed once, not reactive).
const key = location.pathname.split("/").filter(Boolean)[1] ?? "";
const queueStorageKey = `critique:queued:${key}`;
const themeStorageKey = "critique:theme";
const panelStorageKey = "critique:panelWidth";

/** Review panel sizing. The panel never narrows past PANEL_MIN, and never grows
 *  so far that the artifact column drops below ARTIFACT_MIN. */
const PANEL_MIN = 400;
const PANEL_DEFAULT = 420;
const ARTIFACT_MIN = 320;

function loadPanelWidth(): number {
  const raw = Number.parseInt(localStorage.getItem(panelStorageKey) ?? "", 10);
  return Number.isFinite(raw) && raw >= PANEL_MIN ? raw : PANEL_DEFAULT;
}

function loadQueueFromStorage(): Prompt[] {
  try {
    const raw = sessionStorage.getItem(queueStorageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Prompt[]) : [];
  } catch {
    return [];
  }
}

function loadThemeFromStorage(): Theme {
  const raw = localStorage.getItem(themeStorageKey);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

function effectiveTheme(sel: Theme): "light" | "dark" {
  return sel === "system"
    ? matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : sel;
}

const chord = navigator.platform.toLowerCase().includes("mac")
  ? "⌘I"
  : "Ctrl+I";

export function App() {
  const [noSession, setNoSession] = React.useState(false);
  const [file, setFile] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [token, setToken] = React.useState("");
  const [revision, setRevision] = React.useState(0);
  const [reviews, setReviews] = React.useState<Review[]>([]);
  const [presence, setPresence] = React.useState<Presence>("waiting");
  const [ended, setEnded] = React.useState(false);
  const [queued, setQueued] = React.useState<Prompt[]>(loadQueueFromStorage);
  const [annotation, setAnnotation] = React.useState(true);
  const [themeSelection, setThemeSelection] =
    React.useState<Theme>(loadThemeFromStorage);
  const [copied, setCopied] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [panelWidth, setPanelWidth] = React.useState(loadPanelWidth);
  const [panelMax, setPanelMax] = React.useState(PANEL_MIN);
  const [dragging, setDragging] = React.useState(false);

  // Refs that give effects/handlers always-current values without re-registering.
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const tokenRef = React.useRef("");
  const annotationRef = React.useRef(true);
  const lastScrollRef = React.useRef({ x: 0, y: 0 });
  const lastReviewStateRef = React.useRef<ReviewState | null>(null);
  const endedRef = React.useRef(false);
  const queuedRef = React.useRef<Prompt[]>(queued);
  const themeSelectionRef = React.useRef<Theme>(themeSelection);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const mainRef = React.useRef<HTMLElement>(null);
  const handleRef = React.useRef<HTMLDivElement>(null);
  // Live width during a drag: mutated straight onto the DOM so dragging never
  // re-renders the transcript. React state is synced once, on pointer release.
  const widthRef = React.useRef(panelWidth);
  const draggingRef = React.useRef(false);
  // Silence unused-variable lint — presence drives SSE→ended transition only.
  void presence;

  // ---- ref syncs (keep mirrors current) ---------------------------------------
  React.useEffect(() => {
    tokenRef.current = token;
  }, [token]);
  React.useEffect(() => {
    annotationRef.current = annotation;
  }, [annotation]);
  React.useEffect(() => {
    endedRef.current = ended;
  }, [ended]);
  React.useEffect(() => {
    queuedRef.current = queued;
  }, [queued]);
  React.useEffect(() => {
    themeSelectionRef.current = themeSelection;
  }, [themeSelection]);

  // ---- helpers ----------------------------------------------------------------

  const toSdk = React.useCallback((msg: ChromeToSdk) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  function persistQueue(next: Prompt[]) {
    sessionStorage.setItem(queueStorageKey, JSON.stringify(next));
  }

  function artifactSrc() {
    return `/artifact/${key}/index.html?token=${encodeURIComponent(token)}&rev=${revision}`;
  }

  // ---- actions ----------------------------------------------------------------

  function handleSetMode(enabled: boolean) {
    setAnnotation(enabled);
    toSdk({ type: "critique:setMode", enabled });
    toast.success(enabled ? "Annotations enabled" : "Annotations disabled");
  }

  function applyTheme(sel: Theme) {
    setThemeSelection(sel);
    themeSelectionRef.current = sel;
    localStorage.setItem(themeStorageKey, sel);
    document.documentElement.dataset.theme = effectiveTheme(sel);
    toSdk({ type: "critique:setTheme", theme: sel });
    const label =
      sel === "system" ? "System" : sel === "light" ? "Light" : "Dark";
    toast.success(`Theme set to ${label}`);
  }

  async function makeChanges() {
    if (endedRef.current || queuedRef.current.length === 0) return;
    const res = await fetch(`/api/${key}/prompts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompts: queuedRef.current }),
    });
    if (!res.ok) return;
    setQueued([]);
    persistQueue([]);
  }

  async function submitMessage() {
    const text = draft.trim();
    if (endedRef.current || text === "") return;
    const prompt: Prompt = {
      uid: `msg:${Date.now().toString(36)}`,
      prompt: text,
      selector: "",
      tag: "message",
      text: "",
      target: null,
    };
    const res = await fetch(`/api/${key}/prompts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompts: [prompt] }),
    });
    if (!res.ok) return;
    setDraft("");
  }

  // ---- panel resize -----------------------------------------------------------

  /** Clamp to [PANEL_MIN, container - ARTIFACT_MIN] against the live container. */
  function clampPanel(px: number): number {
    const total =
      mainRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const max = Math.max(PANEL_MIN, total - ARTIFACT_MIN);
    return Math.min(Math.max(Math.round(px), PANEL_MIN), max);
  }

  /** Paint a new width without re-rendering (drag path). */
  function paintPanelWidth(px: number) {
    widthRef.current = px;
    mainRef.current?.style.setProperty("--panel-w", `${px}px`);
    handleRef.current?.setAttribute("aria-valuenow", String(px));
  }

  /** Commit a width to React state and storage (drag end / keyboard). */
  function commitPanelWidth(px: number) {
    paintPanelWidth(px);
    setPanelWidth(px);
    localStorage.setItem(panelStorageKey, String(px));
  }

  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    // Pointer capture keeps move events on the handle even once the cursor is
    // over the artifact iframe, which would otherwise swallow them.
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
  }

  function onHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    const rect = mainRef.current?.getBoundingClientRect();
    if (!rect) return;
    paintPanelWidth(clampPanel(rect.right - e.clientX));
  }

  function onHandlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    commitPanelWidth(widthRef.current);
  }

  function onHandleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 64 : 16;
    // Left grows the panel, matching the direction you'd drag the divider.
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      commitPanelWidth(clampPanel(widthRef.current + step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      commitPanelWidth(clampPanel(widthRef.current - step));
    }
  }

  async function endSession() {
    if (endedRef.current) return;
    const id = toast.loading("Ending review session...");
    try {
      const res = await fetch(`/api/${key}/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ by: "user" }),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setEnded(true);
      endedRef.current = true;
      setAnnotation(false);
      annotationRef.current = false;
      toSdk({ type: "critique:setMode", enabled: false });
      toast.success("Review session ended", { id });
    } catch {
      toast.error("Failed to end session", { id });
    }
  }

  function removeQueued(index: number) {
    setQueued((q) => {
      const next = q.slice();
      next.splice(index, 1);
      persistQueue(next);
      return next;
    });
  }

  function copyFile() {
    void navigator.clipboard?.writeText(file);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  // ---- effects ----------------------------------------------------------------

  // -1. Keep the panel width legal as the container resizes, and track the
  //     current maximum so the divider reports an honest aria-valuemax.
  //     Committing a width only changes the grid tracks inside `main`, never
  //     `main` itself, so the observer below cannot feed back into itself.
  React.useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    function measure() {
      const total = el!.getBoundingClientRect().width;
      setPanelMax(Math.max(PANEL_MIN, total - ARTIFACT_MIN));
      const next = clampPanel(widthRef.current);
      if (next !== widthRef.current) commitPanelWidth(next);
    }
    measure();
    // Both signals on purpose: `resize` is guaranteed for the window-resize case,
    // while the observer also catches container-only changes. `measure` is
    // idempotent (it commits only on an actual change), so overlap is harmless.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 1. Boot: fetch initial state, set DOM title, apply theme before paint.
  React.useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme(
      themeSelectionRef.current,
    );
    void (async () => {
      const res = await fetch(`/api/${key}/state`);
      if (res.status === 404) {
        setNoSession(true);
        return;
      }
      const s: StatePayload = await res.json();
      setToken(s.token);
      tokenRef.current = s.token;
      setRevision(s.revision);
      setFile(s.file);
      setTitle(s.title);
      document.title = `critique — ${s.title}`;
      const isEnded = s.ended;
      setEnded(isEnded);
      endedRef.current = isEnded;
      if (isEnded) {
        setAnnotation(false);
        annotationRef.current = false;
      }
      setReviews(s.reviews);
      setPresence(isEnded ? "ended" : s.presence);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Window message handler — registered once; uses refs to read live state.
  React.useEffect(() => {
    function onMessage(event: MessageEvent<SdkToChrome>) {
      const msg = event.data;
      if (
        !msg ||
        typeof msg.type !== "string" ||
        !msg.type.startsWith("critique:")
      )
        return;
      if (msg.token !== tokenRef.current) return;
      switch (msg.type) {
        case "critique:ready":
          toSdk({ type: "critique:setMode", enabled: annotationRef.current });
          toSdk({
            type: "critique:setTheme",
            theme: themeSelectionRef.current,
          });
          toSdk({
            type: "critique:restoreScroll",
            x: lastScrollRef.current.x,
            y: lastScrollRef.current.y,
          });
          toSdk({
            type: "critique:restoreReviewState",
            state: lastReviewStateRef.current,
          });
          break;
        case "critique:queuePrompt":
          setQueued((q) => {
            const next = [...q, msg.prompt];
            persistQueue(next);
            return next;
          });
          break;
        case "critique:sendQueued":
          void makeChanges();
          break;
        case "critique:end":
          void endSession();
          break;
        case "critique:scroll":
          lastScrollRef.current = { x: msg.x, y: msg.y };
          break;
        case "critique:reviewState":
          lastReviewStateRef.current = msg.state;
          break;
        case "critique:toggleMode":
          handleSetMode(!annotationRef.current);
          break;
      }
    }
    window.addEventListener("message", onMessage as EventListener);
    return () =>
      window.removeEventListener("message", onMessage as EventListener);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 3. SSE — reconnects if key changes (it never does after mount).
  React.useEffect(() => {
    if (!key) return;
    const es = new EventSource(`/events/${key}`);
    es.addEventListener("presence", (e) => {
      const data: { state: Presence } = JSON.parse(
        (e as MessageEvent<string>).data,
      );
      if (!endedRef.current) {
        if (data.state === "ended") {
          setEnded(true);
          endedRef.current = true;
          setAnnotation(false);
          annotationRef.current = false;
          toSdk({ type: "critique:setMode", enabled: false });
        }
        setPresence(data.state);
      }
    });
    es.addEventListener("review-sync", (e) => {
      const data: { reviews: Review[] } = JSON.parse(
        (e as MessageEvent<string>).data,
      );
      setReviews(data.reviews);
    });
    es.addEventListener("reload", () => {
      // refreshState: only calls stable setters, safe from stale closure.
      void fetch(`/api/${key}/state`).then(async (res) => {
        const s: StatePayload = await res.json();
        setToken(s.token);
        tokenRef.current = s.token;
        setRevision(s.revision);
      });
    });
    return () => es.close();
  }, [key]);

  // 4. Keydown — Cmd/Ctrl+I toggles annotation mode.
  React.useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "i" || e.key === "I")) {
        e.preventDefault();
        handleSetMode(!annotationRef.current);
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 5. System-theme OS change listener — only active when user chose "system".
  React.useEffect(() => {
    if (themeSelection !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themeSelection]);

  // ---- render -----------------------------------------------------------------

  if (noSession) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">No active session.</p>
      </div>
    );
  }

  return (
    <>
      <main
        ref={mainRef}
        style={{ "--panel-w": `${panelWidth}px` } as React.CSSProperties}
        className="grid h-full grid-cols-1 md:grid-cols-[1fr_var(--panel-w)]"
      >
        <div
          className={cn(
            "relative overflow-hidden bg-white dark:bg-[#0b0c10]",
            dragging && "pointer-events-none",
          )}
        >
          {token && (
            <iframe
              ref={iframeRef}
              src={artifactSrc()}
              title="artifact"
              sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-modals"
              className="block h-full w-full border-0 bg-white dark:bg-[#0b0c10]"
            />
          )}
        </div>
        <aside className="relative z-10 flex min-h-0 flex-col bg-panel text-panel-foreground shadow-[-10px_0_28px_-6px_var(--panel-shadow)]">
          {/* biome-ignore lint/a11y/useSemanticElements: interactive splitter bar requires role="separator" with aria-valuenow/min/max; <hr> is static */}
          <div
            ref={handleRef}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize review panel"
            aria-valuenow={panelWidth}
            aria-valuemin={PANEL_MIN}
            aria-valuemax={panelMax}
            tabIndex={0}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            onKeyDown={onHandleKeyDown}
            title="Drag to resize, or focus and use arrow keys"
            className={cn(
              "absolute inset-y-0 left-0 z-20 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none md:block",
              "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:transition-colors",
              "hover:after:bg-primary/40 focus-visible:outline-none focus-visible:after:bg-primary",
              dragging && "after:bg-primary/60",
            )}
          />
          <header className="z-10 flex items-start justify-between gap-2 border-b bg-chrome p-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h1 className="text-xl font-semibold leading-tight">Reviewing</h1>
              <button
                type="button"
                onClick={copyFile}
                className={cn(
                  "group flex items-center gap-1.5 text-[13px] transition-colors",
                  copied
                    ? "text-ok"
                    : "text-muted-foreground hover:text-foreground",
                )}
                title={file}
              >
                <span className="truncate">{title}</span>
                {copied ? (
                  <Check className="size-3.5 shrink-0" />
                ) : (
                  <Copy className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </button>
            </div>
            <SettingsMenu
              annotation={annotation}
              onToggleAnnotate={() => handleSetMode(!annotation)}
              annotateChord={chord}
              theme={themeSelection}
              onThemeChange={applyTheme}
              onReload={() =>
                void (async () => {
                  const id = toast.loading("Reloading...");
                  try {
                    const res = await fetch(`/api/${key}/state`);
                    if (!res.ok)
                      throw new Error(`Server responded ${res.status}`);
                    const s: StatePayload = await res.json();
                    setToken(s.token);
                    tokenRef.current = s.token;
                    setRevision(s.revision);
                    toast.success("Reloaded", { id });
                  } catch {
                    toast.error("Failed to reload", { id });
                  }
                })()
              }
              onEnd={() => void endSession()}
            />
          </header>
          {ended && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-panel/80 backdrop-blur-sm">
              <CircleOff className="size-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Review session ended.
              </p>
            </div>
          )}
          <div
            ref={scrollRef}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3"
          >
            <Transcript reviews={reviews} />
          </div>
          <div className="z-10 flex flex-col gap-2 bg-chrome p-3">
            <PendingChanges queued={queued} onRemove={removeQueued} />
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitMessage();
                }
              }}
              disabled={ended}
              placeholder="Ask the agent or describe a change..."
              className="max-h-40 bg-card"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void makeChanges()}
                disabled={ended || queued.length === 0}
              >
                {queued.length > 0
                  ? `Request changes (${queued.length})`
                  : "Request changes"}
              </Button>
              <Button
                type="button"
                onClick={() => void submitMessage()}
                disabled={ended || draft.trim() === ""}
              >
                Submit
              </Button>
            </div>
          </div>
        </aside>
      </main>
      <Toaster
        theme={themeSelection === "system" ? "system" : themeSelection}
      />
    </>
  );
}
