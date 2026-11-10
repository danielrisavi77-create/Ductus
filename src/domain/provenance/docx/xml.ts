/**
 * Safe XML scanner for DOCX parts (DAN-242). It accepts the small subset of
 * XML 1.0 that OOXML uses and refuses the rest instead of guessing: UTF-8
 * only, no DOCTYPE or other markup declaration (so no DTD, no entity of its
 * own, no outside resource), no processing instruction except the leading XML
 * declaration, only the five predefined entities and valid character
 * references, bounded depth, and namespaces resolved as the Namespaces spec
 * says. It hands the visitor element and attribute names only, never text or
 * attribute values (D-198 t. 5). Element and attribute names are ASCII.
 */
import { type DocxLimits, DocxRejected, resolveDocxLimits } from "./limits";

export interface XmlName {
  uri: string;
  local: string;
}
export interface XmlElement extends XmlName {
  attributes: readonly XmlName[];
}
export interface XmlVisitor {
  open?(element: XmlElement): void;
  close?(element: XmlName): void;
}

interface Frame {
  qname: string;
  name: XmlName;
  bindings: Map<string, string>;
}

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
const NAME = "[A-Za-z_][A-Za-z0-9._-]*";
const QNAME = `${NAME}(?::${NAME})?`;
const DECL = /^<\?xml\s+version\s*=\s*(["'])1\.[0-9]+\1(?:\s+encoding\s*=\s*(["'])([A-Za-z][A-Za-z0-9._-]*)\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\4)?\s*\?>/;
const TAG = new RegExp(`<(${QNAME})`, "y");
const ATTR = new RegExp(`\\s+(${QNAME})\\s*=\\s*(?:"([^<"]*)"|'([^<']*)')`, "y");
const TAG_END = /\s*(\/?)>/y;
const END_TAG = new RegExp(`</(${QNAME})\\s*>`, "y");
const REF = /&(?:(lt|gt|amp|quot|apos)|#([0-9]+)|#x([0-9a-fA-F]+));/y;
const REFS = new RegExp(REF.source, "g");
const BAD_CHAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/;
const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const fail = (code: ConstructorParameters<typeof DocxRejected>[0]): never => {
  throw new DocxRejected(code);
};

export function scanXml(bytes: Uint8Array, limits: Partial<DocxLimits> | undefined, visitor: XmlVisitor): void {
  const lim = resolveDocxLimits(limits);
  if (!(bytes instanceof Uint8Array)) fail("INPUT_INVALID");
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("XML_ENCODING");
  }
  if (BAD_CHAR.test(text)) fail("XML_INVALID");

  let i = 0;
  if (/^<\?xml[\s?]/.test(text)) {
    const decl = DECL.exec(text) ?? fail("XML_INVALID");
    if (decl[3] !== undefined && decl[3].toLowerCase() !== "utf-8") fail("XML_ENCODING");
    i = decl[0].length;
  }
  const stack: Frame[] = [];
  let rootDone = false;
  let rootSeen = false;
  const lookup = (prefix: string): string | undefined => {
    if (prefix === "xml") return XML_NS;
    for (let k = stack.length - 1; k >= 0; k--) {
      const uri = stack[k].bindings.get(prefix);
      if (uri !== undefined) return uri;
    }
    return prefix === "" ? "" : undefined;
  };
  const resolve = (qname: string, isElement: boolean): XmlName => {
    const colon = qname.indexOf(":");
    if (colon === -1) return { uri: isElement ? (lookup("") ?? "") : "", local: qname };
    const uri = lookup(qname.slice(0, colon)) ?? fail("XML_NAMESPACE");
    return { uri, local: qname.slice(colon + 1) };
  };

  while (i < text.length) {
    if (text[i] !== "<") {
      const end = text.indexOf("<", i) === -1 ? text.length : text.indexOf("<", i);
      const run = text.slice(i, end);
      if (stack.length === 0 ? /\S/.test(run) : run.includes("]]>")) fail("XML_INVALID");
      checkRefs(run);
      i = end;
    } else if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end === -1 || text.slice(i + 4, end).includes("--") || text[end - 1] === "-") fail("XML_INVALID");
      i = end + 3;
    } else if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i + 9);
      if (end === -1 || stack.length === 0) fail("XML_INVALID");
      i = end + 3;
    } else if (text.startsWith("<!", i)) {
      fail("XML_DOCTYPE");
    } else if (text.startsWith("<?", i)) {
      fail("XML_PI");
    } else if (text.startsWith("</", i)) {
      END_TAG.lastIndex = i;
      const m = END_TAG.exec(text) ?? fail("XML_INVALID");
      const top = stack.pop();
      if (top === undefined || top.qname !== m[1]) fail("XML_INVALID");
      visitor.close?.(top!.name);
      rootDone = stack.length === 0;
      i = END_TAG.lastIndex;
    } else {
      if (rootDone) fail("XML_INVALID");
      TAG.lastIndex = i;
      const qname = (TAG.exec(text) ?? fail("XML_INVALID"))[1];
      let at = TAG.lastIndex;
      const raw = new Set<string>();
      const bindings = new Map<string, string>();
      for (;;) {
        ATTR.lastIndex = at;
        const m = ATTR.exec(text);
        if (m === null) break;
        const [name, value] = [m[1], m[2] ?? m[3]];
        checkRefs(value);
        if (raw.has(name)) fail("XML_INVALID");
        if (name === "xmlns" || name.startsWith("xmlns:")) bind(bindings, name, decodeRefs(value));
        else raw.add(name);
        at = ATTR.lastIndex;
      }
      TAG_END.lastIndex = at;
      const close = TAG_END.exec(text) ?? fail("XML_INVALID");
      if (stack.length + 1 > lim.maxXmlDepth) fail("XML_DEPTH");
      if (qname.startsWith("xmlns:")) fail("XML_NAMESPACE");
      const frame: Frame = { qname, name: { uri: "", local: "" }, bindings };
      stack.push(frame);
      frame.name = resolve(qname, true);
      const attributes = [...raw].map((n) => resolve(n, false));
      const expanded = new Set(attributes.map((a) => `${a.uri} ${a.local}`));
      if (expanded.size !== attributes.length) fail("XML_INVALID");
      visitor.open?.({ ...frame.name, attributes });
      if (close[1] === "/") {
        stack.pop();
        visitor.close?.(frame.name);
        rootDone = stack.length === 0;
      }
      rootSeen = true;
      i = TAG_END.lastIndex;
    }
  }
  if (!rootSeen || stack.length > 0) fail("XML_INVALID");
}

function bind(bindings: Map<string, string>, name: string, uri: string): void {
  const prefix = name === "xmlns" ? "" : name.slice(6);
  if (bindings.has(prefix)) fail("XML_INVALID");
  if (prefix === "xmlns" || uri === XMLNS_NS) fail("XML_NAMESPACE");
  if ((prefix === "xml") !== (uri === XML_NS)) fail("XML_NAMESPACE");
  if (prefix !== "" && uri === "") fail("XML_NAMESPACE");
  bindings.set(prefix, uri);
}

/** Every '&' starts a predefined entity or a reference to an allowed character. */
function checkRefs(s: string): void {
  for (let k = s.indexOf("&"); k !== -1; k = s.indexOf("&", REF.lastIndex)) {
    REF.lastIndex = k;
    const m = REF.exec(s) ?? fail("XML_ENTITY");
    if (m[1] === undefined && !allowedChar(codePoint(m))) fail("XML_ENTITY");
  }
}

function decodeRefs(s: string): string {
  return s.replace(REFS, (_all, named: string | undefined, dec: string | undefined, hex: string | undefined) =>
    named !== undefined ? PREDEFINED[named] : String.fromCodePoint(codePoint([_all, named, dec, hex])),
  );
}

function codePoint(m: readonly (string | undefined)[]): number {
  return m[2] !== undefined ? Number.parseInt(m[2], 10) : Number.parseInt(m[3] ?? "", 16);
}

function allowedChar(c: number): boolean {
  return c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);
}
