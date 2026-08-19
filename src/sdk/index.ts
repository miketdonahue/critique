/**
 * Critique artifact SDK.
 *
 * Injected into the artifact iframe by the server. Provides point-and-click and
 * text-selection annotation, an annotation card, and a `window.critique` API,
 * all wired to the parent chrome frame over postMessage. Agent-agnostic: it only
 * relays feedback; any agent driving the CLI receives it through `critique poll`.
 */
import type {
  ChromeToSdk,
  ElementTarget,
  Prompt,
  PromptTag,
  ReviewState,
  Theme,
  SdkToChrome,
  TextRangeBoundary,
  TextRangeTarget,
} from "../types.ts";

interface CritiqueApi {
  queuePrompt(note: string, options?: Partial<Pick<Prompt, "selector" | "tag" | "text" | "target">>): void;
  sendQueued(): void;
  end(): void;
  setStatus(message: string): void;
}

declare global {
  interface Window {
    critique: CritiqueApi;
  }
}

const scriptSrc = document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : "";
const params = new URLSearchParams(scriptSrc.split("?")[1] ?? "");
const TOKEN = params.get("token") ?? "";
const MAX_TEXT = 240;
const UI_ATTR = "data-critique-ui";
const ACTION_ATTR = "data-critique-action";
const INTERACTIVE = new Set(["a", "button", "input", "select", "textarea", "label", "summary", "option"]);

let annotationMode = true;
let uidCounter = 0;
const uids = new WeakMap<Element, string>();
let hovered: HTMLElement | null = null;
let ignoreNextClick = false;
let shadowRoot: ShadowRoot | null = null;
let scrollQueued = false;
let cardTheme: Theme = "system";

/** Concrete accent for inline element outlines, resolving "system" via the OS. */
function resolveAccent(): string {
  const light = cardTheme === "light" || (cardTheme === "system" && matchMedia("(prefers-color-scheme: light)").matches);
  return light ? "#554dff" : "#8b88ff";
}

/** Reflect the active theme onto the shadow host so the card CSS can react. */
function applyCardTheme(): void {
  if (shadowRoot) (shadowRoot.host as HTMLElement).setAttribute("data-theme", cardTheme);
}

type SdkMessage = SdkToChrome extends infer T ? (T extends T ? Omit<T, "token"> : never) : never;

function post(msg: SdkMessage): void {
  parent.postMessage({ ...msg, token: TOKEN }, "*");
}

function uidFor(el: Element): string {
  let id = uids.get(el);
  if (!id) {
    id = `c${++uidCounter}`;
    uids.set(el, id);
  }
  return id;
}

function isCritiqueUi(node: Node | null): boolean {
  let el = node instanceof Element ? node : node?.parentElement ?? null;
  while (el) {
    if (el.hasAttribute(UI_ATTR)) return true;
    el = el.parentElement;
  }
  return false;
}

function isInteractive(el: Element): boolean {
  if (el.closest(`[${ACTION_ATTR}]`)) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return INTERACTIVE.has(el.tagName.toLowerCase()) || el.closest("a,button,label,summary") !== null;
}

/** Root/layout containers that are never a meaningful annotation target. */
const NON_ANNOTATABLE: Record<string, true> = { html: true, body: true, main: true };

function isNonAnnotatable(el: Element): boolean {
  return NON_ANNOTATABLE[el.tagName.toLowerCase()] === true;
}

function trimText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

function readText(el: Element): string {
  return trimText((el instanceof HTMLElement ? el.innerText : null) || el.textContent || "");
}

/** Stable CSS selector: `tag#id`, else an nth-of-type path up to 5 levels. */
function cssSelector(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && depth < 5; depth++) {
    const tag = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${tag}#${CSS.escape(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
    parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
    node = parent;
  }
  return parts.join(" > ");
}

function ancestorElement(node: Node): Element {
  return node.nodeType === 1 && node instanceof Element ? node : node.parentElement ?? document.body;
}

function elementTarget(el: Element): ElementTarget {
  return { type: "element", uid: uidFor(el), selector: cssSelector(el), tag: el.tagName.toLowerCase(), text: readText(el) };
}

/** Encode a DOM range boundary so the agent (or a reload) can relocate it. */
function rangeBoundary(node: Node, offset: number): TextRangeBoundary {
  const anchor = ancestorElement(node);
  const path: number[] = [];
  let cursor: Node | null = node;
  while (cursor && cursor !== anchor && cursor.parentNode) {
    path.unshift(Array.prototype.indexOf.call(cursor.parentNode.childNodes, cursor));
    cursor = cursor.parentNode;
  }
  return { selector: cssSelector(anchor), path, offset };
}

function textTarget(range: Range, text: string): TextRangeTarget {
  return {
    type: "text-range",
    selector: cssSelector(ancestorElement(range.commonAncestorContainer)),
    text,
    start: rangeBoundary(range.startContainer, range.startOffset),
    end: rangeBoundary(range.endContainer, range.endOffset),
  };
}

// ---- shadow DOM UI ----------------------------------------------------------

const CARD_LIGHT_VARS = `
  --c-bg:#ffffff; --c-text:#15151a; --c-border:#e1e2e8; --c-muted:#5f606b; --c-subtle:#858692;
  --c-inset:#f7f7fb; --c-accent:#554dff; --c-accent-ink:#ffffff;
`;
const CARD_CSS = `
:host {
  all: initial;
  --c-bg:#191b24; --c-text:#f6f7fb; --c-border:#303443; --c-muted:#c0c2ce; --c-subtle:#8f93a5;
  --c-inset:#0e0f14; --c-accent:#8b88ff; --c-accent-ink:#ffffff;
}
:host([data-theme="light"]) {${CARD_LIGHT_VARS}}
@media (prefers-color-scheme: light) {
  :host([data-theme="system"]) {${CARD_LIGHT_VARS}}
}
.card {
  position: fixed; z-index: 2147483647; width: 300px; max-width: calc(100vw - 24px);
  background: var(--c-bg); color: var(--c-text); border: 1px solid var(--c-border); border-radius: 10px;
  box-shadow: 0 12px 28px rgba(0,0,0,.28); padding: 12px; font: 13px/1.45 system-ui, sans-serif;
}
.card h4 { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: var(--c-muted); }
.card .snip { display:block; margin:0 0 14px; padding:6px 8px; background:var(--c-inset); border-radius:6px;
  color:var(--c-muted); font-size:12px; height:52px; overflow-y:auto; }
.card textarea { width:100%; box-sizing:border-box; min-height:64px; resize:vertical; background:var(--c-inset);
  color:var(--c-text); border:1px solid var(--c-border); border-radius:6px; padding:8px; font:inherit; }
.card textarea:focus { outline:2px solid var(--c-accent); outline-offset:0; }
.row { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
.row button { font:inherit; border-radius:6px; padding:6px 12px; cursor:pointer; border:1px solid var(--c-border); }
.cancel { background:transparent; color:var(--c-muted); }
.queue { background:var(--c-accent); color:var(--c-accent-ink); border-color:var(--c-accent); font-weight:600; }
.marker { position:fixed; z-index:2147483646; background:color-mix(in srgb, var(--c-accent) 25%, transparent);
  border:1px solid var(--c-accent); border-radius:2px; pointer-events:none; }
`;

function ensureShadow(): ShadowRoot {
  if (shadowRoot) return shadowRoot;
  const host = document.createElement("div");
  host.setAttribute(UI_ATTR, "root");
  document.documentElement.appendChild(host);
  shadowRoot = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CARD_CSS;
  shadowRoot.appendChild(style);
  host.setAttribute("data-theme", cardTheme);
  return shadowRoot;
}

function clearHighlight(): void {
  if (hovered) hovered.style.outline = "";
  hovered = null;
}

function highlight(el: HTMLElement): void {
  clearHighlight();
  hovered = el;
  el.style.outline = `2px solid ${resolveAccent()}`;
}

interface OpenCard {
  selector: string;
}
let openCard: OpenCard | null = null;

function closeCard(): void {
  ensureShadow()
    .querySelectorAll(".card,.marker")
    .forEach((n) => n.remove());
  clearHighlight();
  openCard = null;
  post({ type: "critique:reviewState", state: { card: null } });
}

function reportCardText(text: string): void {
  if (!openCard) return;
  const state: ReviewState = { card: { selector: openCard.selector, text } };
  post({ type: "critique:reviewState", state });
}

function positionCard(card: HTMLElement, rect: DOMRect): void {
  const margin = 12;
  const width = card.offsetWidth || 300;
  const height = card.offsetHeight || 160;
  let left = rect.left;
  let top = rect.bottom + 8;
  if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
  if (left < margin) left = margin;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 8);
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

interface CardOptions {
  hover?: HTMLElement;
  range?: Range;
  heading: string;
  snippet: string;
  selector: string;
  makeTarget: () => ElementTarget | TextRangeTarget;
  tag: PromptTag;
  initialText?: string;
}

function showCard(opts: CardOptions): void {
  closeCard();
  const shadow = ensureShadow();
  const rect = opts.range ? opts.range.getBoundingClientRect() : opts.hover!.getBoundingClientRect();

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <h4></h4>
    <span class="snip"></span>
    <textarea placeholder="What should change here?"></textarea>
    <div class="row">
      <button class="cancel" type="button">Cancel</button>
      <button class="queue" type="button">Comment</button>
    </div>`;
  card.querySelector("h4")!.textContent = opts.heading;
  card.querySelector(".snip")!.textContent = opts.snippet || "(no text)";
  const textarea = card.querySelector("textarea")!;
  if (opts.initialText) textarea.value = opts.initialText;

  if (opts.range) {
    for (const r of Array.from(opts.range.getClientRects())) {
      const marker = document.createElement("div");
      marker.className = "marker";
      marker.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
      shadow.appendChild(marker);
    }
  } else if (opts.hover) {
    highlight(opts.hover);
  }

  const queue = (): boolean => {
    const note = textarea.value.trim();
    if (!note) {
      textarea.focus();
      return false;
    }
    const prompt: Prompt = {
      uid: `q:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`,
      prompt: note,
      selector: opts.selector,
      tag: opts.tag,
      text: opts.snippet,
      target: opts.makeTarget(),
    };
    post({ type: "critique:queuePrompt", prompt });
    return true;
  };

  card.querySelector(".cancel")!.addEventListener("click", closeCard);
  card.querySelector(".queue")!.addEventListener("click", () => {
    if (queue()) closeCard();
  });
  textarea.addEventListener("input", () => reportCardText(textarea.value));
  textarea.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (!queue()) return;
    const alsoSend = e.metaKey || e.ctrlKey;
    closeCard();
    if (alsoSend) post({ type: "critique:sendQueued" });
  });

  shadow.appendChild(card);
  openCard = { selector: opts.selector };
  positionCard(card, rect);
  setTimeout(() => textarea.focus(), 0);
}

function annotateElement(el: HTMLElement, initialText?: string): void {
  showCard({
    hover: el,
    heading: "Request change",
    snippet: readText(el),
    selector: cssSelector(el),
    tag: "element",
    makeTarget: () => elementTarget(el),
    initialText,
  });
}

function annotateSelection(range: Range, text: string): void {
  showCard({
    range,
    heading: "Request text change",
    snippet: text,
    selector: cssSelector(ancestorElement(range.commonAncestorContainer)),
    tag: "text",
    makeTarget: () => textTarget(range, text),
  });
}

// ---- mode -------------------------------------------------------------------

let cursorStyle: HTMLStyleElement | null = null;

function setAnnotationMode(enabled: boolean): void {
  annotationMode = enabled;
  if (enabled) {
    if (!cursorStyle) {
      cursorStyle = document.createElement("style");
      cursorStyle.setAttribute(UI_ATTR, "cursor");
      cursorStyle.textContent = `*{cursor:default!important}
        a,button,input,select,textarea,label,summary,[${ACTION_ATTR}],[contenteditable]{cursor:pointer!important}`;
      document.head.appendChild(cursorStyle);
    }
  } else {
    cursorStyle?.remove();
    cursorStyle = null;
    closeCard();
  }
}

// ---- public API -------------------------------------------------------------

window.critique = {
  queuePrompt(note, options = {}) {
    const prompt: Prompt = {
      uid: `api:${Date.now().toString(36)}`,
      prompt: note,
      selector: options.selector ?? "",
      tag: options.tag ?? "message",
      text: options.text ?? "",
      target: options.target ?? null,
    };
    post({ type: "critique:queuePrompt", prompt });
  },
  sendQueued() {
    post({ type: "critique:sendQueued" });
  },
  end() {
    post({ type: "critique:end" });
  },
  setStatus(message) {
    post({ type: "critique:queuePrompt", prompt: { uid: `status:${Date.now()}`, prompt: message, selector: "", tag: "message", text: "", target: null } });
  },
};

// ---- chrome -> sdk messages -------------------------------------------------

window.addEventListener("message", (event: MessageEvent<ChromeToSdk>) => {
  const msg = event.data;
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("critique:")) return;
  if (msg.type === "critique:setMode") {
    setAnnotationMode(msg.enabled);
  } else if (msg.type === "critique:setTheme") {
    cardTheme = msg.theme;
    applyCardTheme();
  } else if (msg.type === "critique:restoreScroll") {
    window.scrollTo(msg.x, msg.y);
  } else if (msg.type === "critique:restoreReviewState") {
    const card = msg.state?.card;
    const el = card?.selector ? document.querySelector(card.selector) : null;
    if (el instanceof HTMLElement) annotateElement(el, card!.text);
  } else if (msg.type === "critique:reveal") {
    const el = document.querySelector(msg.selector);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      highlight(el);
      setTimeout(clearHighlight, 1600);
    }
  }
});

// ---- interaction listeners --------------------------------------------------

document.addEventListener(
  "mouseover",
  (e) => {
    if (!annotationMode || openCard) return;
    const el = e.target;
    if (!(el instanceof HTMLElement) || isCritiqueUi(el) || isInteractive(el) || isNonAnnotatable(el)) return;
    highlight(el);
  },
  true,
);

document.addEventListener(
  "mouseout",
  () => {
    if (annotationMode && !openCard) clearHighlight();
  },
  true,
);

document.addEventListener(
  "mouseup",
  () => {
    if (!annotationMode) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = trimText(selection.toString());
    if (!text) return;
    const range = selection.getRangeAt(0);
    if (isCritiqueUi(range.commonAncestorContainer)) return;
    ignoreNextClick = true;
    annotateSelection(range, text);
  },
  true,
);

document.addEventListener(
  "click",
  (e) => {
    if (!annotationMode) return;
    const el = e.target;
    if (!(el instanceof HTMLElement) || isCritiqueUi(el)) return;
    if (ignoreNextClick) {
      ignoreNextClick = false;
      return;
    }
    if (isInteractive(el) || isNonAnnotatable(el)) return;
    e.preventDefault();
    e.stopPropagation();
    annotateElement(el);
  },
  true,
);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && openCard) {
    e.preventDefault();
    closeCard();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === "i" || e.key === "I")) {
    e.preventDefault();
    post({ type: "critique:toggleMode" });
  }
});

window.addEventListener(
  "scroll",
  () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      post({ type: "critique:scroll", x: window.scrollX, y: window.scrollY });
    });
  },
  { passive: true },
);

setAnnotationMode(true);
post({ type: "critique:ready" });
