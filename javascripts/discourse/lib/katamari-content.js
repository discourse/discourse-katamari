const PROTECTED =
  "a, button, input, textarea, select, pre, code, svg, math, script, style, [contenteditable], [hidden], [aria-hidden='true'], .spoiler, .elided";
const KEYWORD = /(?<![\p{L}\p{N}_])katamari(?![\p{L}\p{N}_])/giu;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu;
const UNCOLLECTIBLE =
  "input, textarea, select, svg, math, script, style, [contenteditable], [hidden], [aria-hidden='true'], .spoiler:not(.spoiled), .elided, .sr-only, .katamari";

function textNodes(root, excluded = PROTECTED) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return !node.data.trim() || node.parentElement.closest(excluded)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];

  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  return nodes;
}

export function decorateKatamari(root, { label, onActivate }) {
  const buttons = [];

  for (const node of textNodes(root)) {
    const fragment = document.createDocumentFragment();
    let offset = 0;

    for (const match of node.data.matchAll(KEYWORD)) {
      const button = document.createElement("button");
      button.className = "katamari__trigger";
      button.type = "button";
      button.textContent = match[0];
      button.setAttribute("aria-label", label);
      button.addEventListener("click", () => onActivate(button));
      buttons.push(button);
      fragment.append(node.data.slice(offset, match.index), button);
      offset = match.index + match[0].length;
    }

    if (!offset) {
      continue;
    }

    fragment.append(node.data.slice(offset));
    node.replaceWith(fragment);
  }

  return () => {
    for (const button of buttons) {
      button.replaceWith(document.createTextNode(button.textContent));
    }
  };
}

export function pageWords(root, indexed, onDiscard) {
  const nodes = new Set(textNodes(root, UNCOLLECTIBLE));
  const words = [];

  for (const [node, entry] of indexed) {
    if (nodes.has(node) && entry.source === node.data) {
      continue;
    }

    indexed.delete(node);

    for (const word of entry.words) {
      onDiscard(word);
    }
  }

  for (const node of nodes) {
    if (
      !node.parentElement.checkVisibility({
        checkVisibilityCSS: true,
        checkOpacity: true,
      })
    ) {
      continue;
    }

    let entry = indexed.get(node);

    if (entry?.source !== node.data) {
      const ranges = [];

      for (const match of node.data.matchAll(WORD)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        ranges.push({ range, text: match[0], collected: false });
      }

      entry = { source: node.data, words: ranges };
      indexed.set(node, entry);
    }

    words.push(...entry.words);
  }

  return words;
}

export function circleHitsRect({ x, y, radius }, rect) {
  const nearestX = Math.max(rect.left, Math.min(x, rect.right));
  const nearestY = Math.max(rect.top, Math.min(y, rect.bottom));
  return Math.hypot(x - nearestX, y - nearestY) < radius;
}
