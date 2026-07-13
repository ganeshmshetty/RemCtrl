/**
 * @file dom-snapshot.ts
 * @description DOM snapshot serializer that parses active webpage structures to identify and tag interactive elements.
 * Key Exported APIs: `extractNumberedDOMSnapshot` (heavily based on browser-use ClickableElementDetector rules), `extractDOMAsMarkdown` for text-only LLM inputs, and snapshot interfaces (`IndexedDOMElement`, `NumberedDOMSnapshot`, `MarkdownSnapshotResult`).
 * Internal Mechanics: Evaluates scripts within frame contexts to strip non-visual components, compute layouts/styles (checking cursor pointer, visibility bounds, ARIA roles), assign numeric indices (`data-remctrl-index`), generate fallback selectors, and post-process markdown representation.
 * Relations: Invoked by agent loops and action handlers to feed the page state representation directly to the LLM context.
 */

import type { Page } from 'playwright';

export interface IndexedDOMElement {
  index: number;
  tag: string;
  id?: string;
  type?: string;
  label?: string;
  text?: string;
  selector: string;
  domLine: string;
  frameUrl?: string;
}

export interface NumberedDOMSnapshot {
  url: string;
  elements: IndexedDOMElement[];
  formattedDOM: string;
}

/**
 * Scans the active page and all child frames/shadow roots using browser-use heuristics,
 * tags interactive elements, and returns a structured numbered snapshot.
 */
export async function extractNumberedDOMSnapshot(
  page: Page,
  filter?: string
): Promise<NumberedDOMSnapshot> {
  const url = page.url();
  const allElements: IndexedDOMElement[] = [];
  let currentIndex = 1;

  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    try {
      const frameUrl = frame.url();
      const frameElements = await frame.evaluate(
        ([filterStr, startIndex]: [string | undefined, number]) => {
          const doc = (globalThis as any).document;
          const win = (globalThis as any).window;
          if (!doc || !win) return [];

          // Clean up any previously tagged indices
          doc.querySelectorAll('[data-remctrl-index]').forEach((el: any) => {
            el.removeAttribute('data-remctrl-index');
          });

          // Helper: check if element is interactive using browser-use ClickableElementDetector rules
          function hasFormControlDescendant(el: any, maxDepth = 2): boolean {
            if (maxDepth <= 0 || !el) return false;
            const children = Array.from(el.children || []);
            if (el.shadowRoot) {
              children.push(...Array.from(el.shadowRoot.children || []));
            }
            for (const child of children) {
              const tag = (child as any).tagName?.toLowerCase();
              if (['input', 'select', 'textarea'].includes(tag)) return true;
              if (hasFormControlDescendant(child, maxDepth - 1)) return true;
            }
            return false;
          }

          function isInteractiveElement(el: any, style: any): boolean {
            const tag = el.tagName?.toLowerCase();
            if (!tag || ['html', 'body', 'script', 'style', 'noscript'].includes(tag)) return false;

            // Self-exclusion for overlays
            if (el.closest && el.closest('[data-remctrl-exclude]')) return false;

            // 1. Interactive tags
            const interactiveTags: Record<string, boolean> = {
              button: true,
              input: true,
              select: true,
              textarea: true,
              a: true,
              details: true,
              summary: true,
            };
            if (tag in interactiveTags && el.type !== 'hidden') return true;

            // 2. Component wrapper heuristics (label / span wrapping inputs)
            if (tag === 'label' && !el.getAttribute('for') && hasFormControlDescendant(el, 2)) {
              return true;
            }
            if (tag === 'span' && hasFormControlDescendant(el, 2)) {
              return true;
            }

            // 3. Interactive ARIA roles
            const role = el.getAttribute('role');
            const interactiveRoles: Record<string, boolean> = {
              button: true,
              link: true,
              menuitem: true,
              option: true,
              radio: true,
              checkbox: true,
              tab: true,
              textbox: true,
              combobox: true,
              slider: true,
              spinbutton: true,
              search: true,
              searchbox: true,
            };
            if (role && role in interactiveRoles) return true;

            // 4. Explicit interactive attributes or tabindex
            if (
              el.getAttribute('onclick') ||
              el.getAttribute('onmousedown') ||
              el.getAttribute('onkeydown') ||
              el.contentEditable === 'true' ||
              (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1')
            ) {
              return true;
            }

            // 5. Computed cursor: pointer style
            if (style && style.cursor === 'pointer') {
              return true;
            }

            // 6. Search indicators in id/class/data attributes
            const searchIndicators = ['search', 'magnify', 'lookup', 'find', 'query'];
            const classStr = (el.className && typeof el.className === 'string' ? el.className : '').toLowerCase();
            const idStr = (el.id || '').toLowerCase();
            if (searchIndicators.some((ind) => classStr.includes(ind) || idStr.includes(ind))) {
              return true;
            }

            return false;
          }

          // Recursively collect candidates across normal DOM and open shadow roots
          const candidates: any[] = [];
          const seenNodes = new Set<any>();

          function collectNodes(rootNode: any) {
            if (!rootNode) return;
            const children = Array.from(rootNode.children || rootNode.childNodes || []);
            for (const rawChild of children) {
              const child = rawChild as any;
              if (child && child.nodeType === 1) { // ELEMENT_NODE
                if (!seenNodes.has(child)) {
                  seenNodes.add(child);
                  candidates.push(child);
                }
                if (child.shadowRoot) {
                  collectNodes(child.shadowRoot);
                }
                collectNodes(child);
              }
            }
          }

          collectNodes(doc.documentElement || doc.body);

          const elements: Array<{
            index: number;
            tag: string;
            id?: string;
            type?: string;
            label?: string;
            text?: string;
            selector: string;
            domLine: string;
          }> = [];

          let idx = startIndex;

          for (const htmlEl of candidates) {
            const style = win.getComputedStyle ? win.getComputedStyle(htmlEl) : null;
            if (!isInteractiveElement(htmlEl, style)) continue;

            // Visibility filter
            const rect = htmlEl.getBoundingClientRect ? htmlEl.getBoundingClientRect() : { width: 0, height: 0 };
            const isFileInput = htmlEl.tagName.toLowerCase() === 'input' && htmlEl.type === 'file';

            if (
              rect.width === 0 ||
              rect.height === 0 ||
              (style && (style.display === 'none' || style.visibility === 'hidden' || (!isFileInput && style.opacity === '0')))
            ) {
              continue;
            }

            const tag = htmlEl.tagName.toLowerCase();
            const id = htmlEl.id || undefined;
            const type = htmlEl.type || undefined;
            const ariaLabel = htmlEl.getAttribute('aria-label') || undefined;
            const placeholder = htmlEl.placeholder || undefined;
            const name = htmlEl.name || undefined;
            const role = htmlEl.getAttribute('role') || undefined;
            const href = htmlEl.getAttribute('href') || undefined;

            const label = ariaLabel || placeholder || name || htmlEl.title || undefined;

            const innerText = (htmlEl.innerText || htmlEl.textContent || '')
              .replace(/\s+/g, ' ')
              .trim();
            const shortText = innerText.length > 55 ? innerText.slice(0, 52) + '...' : innerText;

            // Apply filter if provided
            if (filterStr) {
              const needle = filterStr.toLowerCase();
              const haystack = `${tag} ${id || ''} ${label || ''} ${shortText}`.toLowerCase();
              if (!haystack.includes(needle)) {
                continue;
              }
            }

            // Tag element in DOM so act({ index }) can locate it deterministically
            if (typeof htmlEl.setAttribute === 'function') {
              htmlEl.setAttribute('data-remctrl-index', String(idx));
            }

            // Build CSS fallback selector
            let selector = '';
            if (id && !/^\d|[^a-zA-Z0-9_-]/.test(id)) {
              selector = `#${id}`;
            } else if (name) {
              selector = `${tag}[name="${name}"]`;
            } else if (ariaLabel) {
              selector = `${tag}[aria-label="${ariaLabel}"]`;
            } else {
              selector = `[data-remctrl-index="${idx}"]`;
            }

            // Format browser-use style DOM string representation
            const attrsList: string[] = [];
            if (type && type !== 'text') attrsList.push(`type="${type}"`);
            if (id) attrsList.push(`id="${id}"`);
            if (name) attrsList.push(`name="${name}"`);
            if (role) attrsList.push(`role="${role}"`);
            if (label) attrsList.push(`label="${label}"`);

            // HTML5 Date/Time format hints (browser-use serializer.py)
            if (tag === 'input' && type) {
              const formatMap: Record<string, string> = {
                date: 'YYYY-MM-DD',
                time: 'HH:MM',
                'datetime-local': 'YYYY-MM-DDTHH:MM',
                month: 'YYYY-MM',
                week: 'YYYY-W##',
              };
              if (formatMap[type]) {
                attrsList.push(`format="${formatMap[type]}"`);
              }
            }

            // Compound <select> options enrichment (browser-use serializer.py)
            if (tag === 'select') {
              const options = Array.from(htmlEl.querySelectorAll('option'))
                .map((opt: any) => (opt.textContent || '').trim())
                .filter(Boolean);
              if (options.length > 0) {
                const topOpts = options.slice(0, 5).join('|');
                attrsList.push(`options="${topOpts}${options.length > 5 ? '|...' : ''}"`);
              }
            }

            // State attributes from eval_serializer.py
            for (const attr of ['checked', 'selected', 'disabled', 'required', 'readonly', 'aria-expanded', 'aria-pressed', 'aria-checked']) {
              if (htmlEl.hasAttribute(attr) || htmlEl[attr] === true) {
                const val = htmlEl.getAttribute(attr);
                attrsList.push(val && val !== 'true' ? `${attr}="${val}"` : attr);
              }
            }

            // Validation attributes from eval_serializer.py
            for (const attr of ['min', 'max', 'step', 'pattern', 'minlength', 'maxlength']) {
              const val = htmlEl.getAttribute(attr);
              if (val) attrsList.push(`${attr}="${val}"`);
            }

            if (href) attrsList.push(`href="${href.length > 30 ? href.slice(0, 27) + '...' : href}"`);

            const attrsStr = attrsList.length > 0 ? ' ' + attrsList.join(' ') : '';
            let domLine = `[${idx}]<${tag}${attrsStr}`;

            if (tag === 'input' || tag === 'img' || tag === 'hr' || tag === 'br') {
              domLine += ' />';
            } else if (shortText) {
              domLine += ` /> ${shortText}`;
            } else {
              domLine += ' />';
            }

            elements.push({
              index: idx,
              tag,
              id,
              type,
              label,
              text: shortText,
              selector,
              domLine,
            });

            idx++;
            if (idx - startIndex > 150) break;
          }

          return elements;
        },
        [filter, currentIndex] as [string | undefined, number]
      );

      for (const el of frameElements) {
        allElements.push({
          ...el,
          frameUrl,
        });
      }
      currentIndex += frameElements.length;
      if (allElements.length > 250) break;
    } catch {
      // frame might be detached or cross-origin restricted in evaluate
    }
  }

  const formattedLines = allElements.map((e) => e.domLine);
  const formattedDOM =
    formattedLines.length > 0
      ? `Interactive Elements (${allElements.length}):\n` + formattedLines.join('\n')
      : 'No interactive elements found.';

  return {
    url,
    elements: allElements,
    formattedDOM,
  };
}

export interface MarkdownSnapshotResult {
  url: string;
  markdown: string;
  charCount: number;
}

/**
 * Extracts clean structure-aware Markdown from the active page, stripping scripts,
 * styles, and SPA JSON blobs (browser-use markdown_extractor.py style).
 * Optionally embeds [N] interactive element indices directly into markdown lines.
 */
export async function extractDOMAsMarkdown(
  page: Page,
  options?: { includeIndices?: boolean; selector?: string }
): Promise<MarkdownSnapshotResult> {
  const url = page.url();
  const includeIndices = options?.includeIndices ?? false;
  const selector = options?.selector;

  const rawMarkdown = await page.evaluate(([incIndices, sel]: [boolean, string | undefined]) => {
    const doc = (globalThis as any).document;
    const win = (globalThis as any).window;
    if (!doc || !doc.body || !win) return '';

    function isHidden(el: any): boolean {
      if (!el || !el.style) return false;
      const style = win.getComputedStyle ? win.getComputedStyle(el) : el.style;
      return style && (style.display === 'none' || style.visibility === 'hidden');
    }

    function nodeToMarkdown(node: any): string {
      if (!node) return '';
      if (node.nodeType === 3) { // TEXT_NODE
        return (node.textContent || '').replace(/\s+/g, ' ');
      }
      if (node.nodeType !== 1) return ''; // Only ELEMENT_NODE

      const el = node;
      const tag = (el.tagName || '').toLowerCase();

      // Skip non-content tags and overlays
      if (['script', 'style', 'noscript', 'svg', 'head', 'meta', 'link'].includes(tag)) return '';
      if (el.closest && el.closest('[data-remctrl-exclude]')) return '';
      if (isHidden(el)) return '';

      // Skip base64 images
      if (tag === 'img' && (el.src || '').startsWith('data:image/')) return '';

      const indexAttr = el.getAttribute('data-remctrl-index');
      const indexPrefix = incIndices && indexAttr ? `[${indexAttr}] ` : '';

      // Headings
      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1], 10);
        const prefix = '#'.repeat(level) + ' ';
        const text = Array.from(el.childNodes).map(nodeToMarkdown).join('').trim();
        return text ? `\n\n${prefix}${indexPrefix}${text}\n\n` : '';
      }

      // Paragraphs
      if (tag === 'p') {
        const text = Array.from(el.childNodes).map(nodeToMarkdown).join('').trim();
        return text ? `\n\n${indexPrefix}${text}\n\n` : '';
      }

      // Interactive Elements
      if (tag === 'button') {
        const text = (el.innerText || el.textContent || 'Button').trim();
        return `${indexPrefix}**[Button: ${text}]** `;
      }
      if (tag === 'a') {
        const text = (el.innerText || el.textContent || 'Link').trim();
        const href = el.getAttribute('href') || '';
        return `${indexPrefix}[${text}](${href}) `;
      }
      if (tag === 'input' || tag === 'textarea') {
        const placeholder = el.placeholder || el.name || el.type || 'input';
        const val = el.value ? `="${el.value}"` : '';
        return `${indexPrefix}[Input(${placeholder})${val}] `;
      }
      if (tag === 'select') {
        const optionsText = Array.from(el.querySelectorAll('option'))
          .map((o: any) => (o.textContent || '').trim())
          .slice(0, 4)
          .join(' | ');
        return `${indexPrefix}[Select: ${optionsText}] `;
      }

      // Lists
      if (tag === 'ul' || tag === 'ol') {
        const items = Array.from(el.children)
          .filter((c: any) => (c.tagName || '').toLowerCase() === 'li')
          .map((li: any) => `- ${Array.from(li.childNodes).map(nodeToMarkdown).join('').trim()}`)
          .join('\n');
        return `\n\n${items}\n\n`;
      }

      // Tables
      if (tag === 'table') {
        const rows = Array.from(el.querySelectorAll('tr'));
        if (rows.length === 0) return '';
        const mdRows: string[] = [];
        let colCount = 0;
        for (let i = 0; i < rows.length; i++) {
          const cells = Array.from((rows[i] as any).querySelectorAll('th, td'));
          colCount = Math.max(colCount, cells.length);
          const cellTexts = cells.map((cell: any) =>
            Array.from(cell.childNodes).map(nodeToMarkdown).join('').trim()
          );
          mdRows.push(`| ${cellTexts.join(' | ')} |`);
          if (i === 0) {
            mdRows.push(`| ${cells.map(() => '---').join(' | ')} |`);
          }
        }
        return `\n\n${mdRows.join('\n')}\n\n`;
      }

      // Recurse children & shadowRoot
      const children = Array.from(el.childNodes || []);
      if (el.shadowRoot) {
        children.push(...Array.from(el.shadowRoot.childNodes || []));
      }
      return children.map(nodeToMarkdown).join('');
    }

    const rootNode = sel ? doc.querySelector(sel) || doc.body : doc.body;
    return nodeToMarkdown(rootNode);
  }, [includeIndices, selector] as [boolean, string | undefined]);

  // Post-process markdown (browser-use _preprocess_markdown_content rules)
  // 1. Remove JSON blobs embedded in SPAs (>100 chars)
  let cleaned = rawMarkdown
    .replace(/\{"\$type":[^}]{100,}\}/g, '')
    .replace(/\{"[^"]{5,}":\{[^}]{100,}\}/g, '');

  // 2. Compress consecutive newlines (4+ newlines -> 3 newlines)
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n').trim();

  return {
    url,
    markdown: cleaned,
    charCount: cleaned.length,
  };
}
