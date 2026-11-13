const DECORATION_EXCLUSIONS =
  "button, input, textarea, select, pre, code, svg, math, script, style, [contenteditable], [hidden], [aria-hidden='true'], .spoiler, .elided, .sr-only, .katamari, .katamari__trigger";
const DECORATIONS = new WeakMap();
const KEYWORD = /(?<![\p{L}\p{N}_])katamari(?![\p{L}\p{N}_])/giu;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu;
const UNCOLLECTIBLE =
  "input, textarea, select, svg, math, script, style, [contenteditable], [hidden], [aria-hidden='true'], .spoiler:not(.spoiled), .elided, .sr-only, .katamari";

function textNodes(root, excluded = DECORATION_EXCLUSIONS) {
  if (root.closest(excluded)) {
    return [];
  }

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT + NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return node.matches(excluded)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP;
        }

        return node.data.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    }
  );
  const nodes = [];

  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  return nodes;
}

function removeDecoration(node) {
  const decoration = DECORATIONS.get(node);

  if (!decoration) {
    return node.data;
  }

  for (const part of decoration.nodes) {
    part.remove();
  }

  DECORATIONS.delete(node);
  return decoration.text;
}

function decorateKatamari(root, { label, onActivate }) {
  for (const node of textNodes(root)) {
    const fragment = document.createDocumentFragment();
    let offset = 0;

    for (const match of node.data.matchAll(KEYWORD)) {
      const link = node.parentElement.closest("a");
      const trigger = document.createElement(link ? "span" : "button");
      trigger.className = "katamari__trigger";
      trigger.textContent = match[0];
      trigger.setAttribute("aria-label", label);
      trigger.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onActivate(trigger);
      });

      if (link) {
        trigger.setAttribute("role", "button");
        trigger.tabIndex = 0;
        trigger.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          trigger.click();
        });
      } else {
        trigger.type = "button";
      }

      fragment.append(node.data.slice(offset, match.index), trigger);
      offset = match.index + match[0].length;
    }

    if (!offset) {
      continue;
    }

    fragment.append(node.data.slice(offset));
    DECORATIONS.set(node, {
      text: node.data,
      nodes: [...fragment.childNodes],
    });
    node.after(fragment);
    node.data = "";
  }
}

export function observeKatamari(root, options) {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        removeDecoration(mutation.target);
        continue;
      }

      for (const node of mutation.removedNodes) {
        if (DECORATIONS.has(node)) {
          const text = removeDecoration(node);
          node.data ||= text;
        }
      }
    }

    decorateKatamari(root, options);
    observer.takeRecords();
  });

  decorateKatamari(root, options);
  observer.observe(root, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  return () => {
    observer.disconnect();

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode;

      if (DECORATIONS.has(node)) {
        node.data = removeDecoration(node);
      }
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

export function circleHitsRect({ x, y }, radius, rect) {
  const nearestX = Math.max(rect.left, Math.min(x, rect.right));
  const nearestY = Math.max(rect.top, Math.min(y, rect.bottom));
  return Math.hypot(x - nearestX, y - nearestY) < radius;
}
