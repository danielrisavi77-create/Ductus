import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { OpenWorkView, openWorkText, type OpenWorkPhase } from "./OpenWorkView";

// #711 F1 (contract 6391402093 §2, §3, §5, §6; amendment 6391779486). The
// assignment id is invented.
const t = messagesHr.workspace;
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const noop = () => {};

const NEW_KEYS = [
  "freeNote", "unavailable", "openLoading", "openNotYet", "openOffline", "openError", "openRetry",
  "openNotAccepting", "openNoticeLink", "openReload", "openReloadButton", "lateNote",
] as const;

const PHASES: OpenWorkPhase[] = [
  { kind: "loading" }, { kind: "notAccepting" }, { kind: "unavailable", signIn: false },
  { kind: "unavailable", signIn: true }, { kind: "reload" }, { kind: "offline" }, { kind: "error" },
  { kind: "idle" },
];

const view = (phase: OpenWorkPhase) =>
  renderToStaticMarkup(h(OpenWorkView, { phase, assignmentId: ID, onStart: noop, onRetry: noop, onReload: noop }));

// DAN-330: the work starts only on the student's click on "Započni rad".
describe("DAN-330 Započni rad", () => {
  it("the texts are the contract's and free of forbidden terms", () => {
    expect(t.startWork).toBe("Započni rad");
    expect(t.notStarted).toBe("Rad još nije započet.");
    expect(messagesHr.submission.notStarted).toBe("Rad još nije započet. Započni ga u radnom prostoru.");
    for (const text of [t.startWork, t.notStarted, messagesHr.submission.notStarted]) {
      expect({ text, found: findForbiddenTerms(text) }).toEqual({ text, found: [] });
      expect(text).not.toMatch(/poslužitelj|spremljen|sinkron|poslan/i);
    }
  });

  it("idle shows the read-only sheet, the notStarted status and an active primary button", () => {
    const html = view({ kind: "idle" });
    expect(html).toContain(`role="status">${t.notStarted}</p>`);
    expect(html).toContain(`<button type="button" class="btn">${t.startWork}</button>`);
    expect(html).toContain('aria-busy="false"');
  });

  it("the click on the idle button is the start handler, and only it", () => {
    const onStart = () => {};
    const tree = OpenWorkView({ phase: { kind: "idle" }, assignmentId: ID, onStart, onRetry: noop, onReload: noop });
    const children = (tree.props as { children: { type: unknown; props: Record<string, unknown> }[] }).children;
    const button = children.find((child) => child?.type === "button");
    expect(button?.props.onClick).toBe(onStart);
  });

  it("while waiting the button stays, aria-disabled and without a handler", () => {
    const html = view({ kind: "loading" });
    expect(html).toContain(`<button type="button" class="btn" aria-disabled="true">${t.startWork}</button>`);
    expect(html).not.toContain(" disabled");
    const tree = OpenWorkView({ phase: { kind: "loading" }, assignmentId: ID, onStart: noop, onRetry: noop, onReload: noop });
    const children = (tree.props as { children: { type: unknown; props: Record<string, unknown> }[] }).children;
    expect(children.find((child) => child?.type === "button")?.props.onClick).toBeUndefined();
  });

  it("no other phase offers to start the work", () => {
    for (const phase of PHASES.filter((p) => p.kind !== "idle" && p.kind !== "loading")) {
      expect(view(phase)).not.toContain(t.startWork);
    }
  });
});

describe("F1 interface text", () => {
  it("every new key is a non-empty string without a forbidden term", () => {
    for (const key of NEW_KEYS) {
      const text = t[key];
      expect(typeof text).toBe("string");
      expect(text.trim()).not.toBe("");
      expect({ key, found: findForbiddenTerms(text) }).toEqual({ key, found: [] });
    }
  });

  it("no new text names the server or a save as the place the text is", () => {
    for (const key of NEW_KEYS) {
      expect(t[key]).not.toMatch(/poslužitelj|spremljen|sinkron/i);
    }
  });

  it("the texts are the contract's", () => {
    expect(t.freeNote).toBe("Ovaj tekst nije vezan uz zadatak i ne predaje se. Zadatak otvarate s njegove obavijesti.");
    expect(t.openOffline).toBe("Za prvo otvaranje rada potrebna je veza.");
    expect(t.openRetry).toBe("Pokušaj ponovno");
    expect(t.lateNote).toBe("Rok zadatka je prošao. Pisati možete i dalje, a predaja će biti označena kao predaja nakon roka.");
    expect(t.openNotYet).toContain("{time}");
  });
});

describe("OpenWorkView", () => {
  it("is read-only in every phase and never an editor", () => {
    for (const phase of PHASES) {
      const html = view(phase);
      expect(html).toContain('aria-disabled="true"');
      expect(html).not.toContain("contenteditable");
      expect(html).toContain(`role="status">${openWorkText(phase)}</p>`);
      expect({ phase, found: findForbiddenTerms(openWorkText(phase)) }).toEqual({ phase, found: [] });
    }
  });

  it("is busy only while waiting for the answer", () => {
    expect(view({ kind: "loading" })).toContain('aria-busy="true"');
    expect(view({ kind: "loading" })).toContain(t.openLoading);
    for (const phase of PHASES.slice(1)) expect(view(phase)).toContain('aria-busy="false"');
  });

  it("offers a retry only for an error, and waits without one when offline", () => {
    expect(view({ kind: "error" })).toContain(`>${t.openRetry}</button>`);
    for (const phase of PHASES.filter((p) => p.kind !== "error")) expect(view(phase)).not.toContain(t.openRetry);
    expect(view({ kind: "offline" })).toContain(t.openOffline);
    expect(view({ kind: "offline" })).not.toContain("<button");
  });

  it("links a changed notice to the assignment's notice, and offers sign-in only for unauthenticated", () => {
    expect(view({ kind: "notAccepting" })).toContain(`href="/zadatak/${ID}"`);
    expect(view({ kind: "unavailable", signIn: true }))
      .toContain(`href="/api/auth/login?returnTo=${encodeURIComponent(`/rad?zadatak=${ID}`)}"`);
    const neutral = view({ kind: "unavailable", signIn: false });
    expect(neutral).toContain(t.unavailable);
    expect(neutral).not.toContain("<a");
    expect(neutral).not.toContain("<button");
  });

  it("reload offers the reload button", () => {
    expect(view({ kind: "reload" })).toContain(`>${t.openReloadButton}</button>`);
  });
});
