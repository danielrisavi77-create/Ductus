function fenceInfo(line) {
  const match = line.match(/^ {0,3}((?:`{3,})|(?:~{3,}))/);
  if (!match) return null;
  return { char: match[1][0], length: match[1].length };
}

function closesFence(line, fence) {
  if (!line || line.startsWith("    ") || line.startsWith("\t")) return false;
  const trimmed = line.trim();
  const pattern = fence.char === "`" ? /^`+\s*$/ : /^~+\s*$/;
  if (!pattern.test(trimmed)) return false;
  const marker = trimmed.match(fence.char === "`" ? /^`+/ : /^~+/)?.[0] ?? "";
  return marker.length >= fence.length;
}

export function metadataLines(body) {
  if (!body) return [];

  const active = [];
  let fence = null;

  for (const rawLine of body.split(/\r?\n/)) {
    if (fence) {
      if (closesFence(rawLine, fence)) fence = null;
      continue;
    }

    const opened = fenceInfo(rawLine);
    if (opened) {
      fence = opened;
      continue;
    }

    // CommonMark indented code blocks begin with four spaces or a tab.
    if (/^(?: {4}|\t)/.test(rawLine)) continue;

    active.push(rawLine.trim());
  }

  return active;
}

export function field(body, name) {
  const prefix = `${name.toLowerCase()}:`;
  for (const line of metadataLines(body)) {
    if (!line.toLowerCase().startsWith(prefix)) continue;
    return line.slice(prefix.length).trim() || null;
  }
  return null;
}

export function canonicalBlock(body, firstField) {
  const first = metadataLines(body).find(Boolean) ?? "";
  return first.toLowerCase().startsWith(`${firstField.toLowerCase()}:`);
}
