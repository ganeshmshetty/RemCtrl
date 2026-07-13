import { Locator } from 'playwright';

/**
 * Computes a stable, deterministic selector for a given Playwright Locator.
 * It evaluates a priority chain inside the page to find the most robust locator
 * that uniquely identifies the element, falling back to a structural CSS path
 * anchored to the nearest stable ancestor if all else fails.
 */
export async function computeStableSelector(locator: Locator): Promise<string> {
  return await locator.evaluate((el: any) => {
    const doc = el.ownerDocument;
    if (!doc) return '';

    const tag = el.tagName.toLowerCase();

    // Helper to escape string for XPath
    function escapeXPathStr(str: string): string {
      if (!str.includes('"')) return `"${str}"`;
      if (!str.includes("'")) return `'${str}'`;
      return `concat(${str.split('"').map(part => `"${part}"`).join(', \'"\', ')})`;
    }

    // 1. Check for Unique ID
    if (el.id) {
      try {
        const idSel = `#${el.id}`;
        if (doc.querySelectorAll(idSel).length === 1) {
          return idSel;
        }
      } catch (e) {}
    }

    // 2. Check for Stable Attributes
    const stableAttrs = ['data-testid', 'data-test-id', 'data-qa', 'name', 'aria-label', 'placeholder', 'title'];
    for (const attr of stableAttrs) {
      const val = el.getAttribute(attr);
      if (val) {
        try {
          const safeVal = val.replace(/"/g, '\\"');
          const attrSel = `[${attr}="${safeVal}"]`;
          if (doc.querySelectorAll(attrSel).length === 1) {
            return attrSel;
          }
        } catch (e) {}
      }
    }

    // 3. Unique Text Content (for buttons/links/labels/spans/headings)
    if (['button', 'a', 'label', 'span', 'h1', 'h2', 'h3'].includes(tag)) {
      const text = el.textContent?.trim();
      if (text && text.length < 50 && !text.includes('\n')) {
        const escapedText = escapeXPathStr(text);
        const xpath = `//${tag}[normalize-space()=${escapedText}]`;
        try {
          const iterator = doc.evaluate(xpath, doc, null, (doc as any).XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          if (iterator.snapshotLength === 1) {
            return `xpath=${xpath}`;
          }
        } catch (e) {}
      }
    }

    // 4. Role + Accessible Name
    let role = el.getAttribute('role');
    if (!role) {
      if (tag === 'button') role = 'button';
      else if (tag === 'a') role = 'link';
      else if (tag === 'input' && el.type === 'checkbox') role = 'checkbox';
      else if (tag === 'input' && el.type === 'radio') role = 'radio';
      else if (tag === 'input' && ['text', 'search', 'email', 'password'].includes(el.type)) role = 'textbox';
    }
    const accName = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.textContent?.trim();
    if (role && accName && accName.length < 50 && !accName.includes('\n')) {
      const escapedName = escapeXPathStr(accName);
      const xpath = `//*[@role="${role}" or local-name()="${tag}"][normalize-space()=${escapedName}]`;
      try {
        const iterator = doc.evaluate(xpath, doc, null, (doc as any).XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (iterator.snapshotLength === 1) {
          return `xpath=${xpath}`;
        }
      } catch (e) {}
    }

    // Helper to get relative xpath from element to ancestor
    function getRelativeXPath(element: any, ancestor: any): string {
      let path = '';
      let curr: any = element;
      while (curr && curr !== ancestor) {
        const currTag = curr.tagName.toLowerCase();
        let index = 1;
        let sibling = curr.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === curr.tagName) index++;
          sibling = sibling.previousElementSibling;
        }
        const step = `${currTag}[${index}]`;
        path = path ? `${step}/${path}` : step;
        curr = curr.parentElement;
      }
      return path;
    }

    // 5. Anchored Relative XPath (anchored to nearest stable ancestor)
    let ancestor: any = el.parentElement;
    let anchorSelector = '';
    while (ancestor && ancestor.nodeType === 1) {
      if (ancestor.id) {
        try {
          const idSel = `#${ancestor.id}`;
          if (doc.querySelectorAll(idSel).length === 1) {
            anchorSelector = idSel;
            break;
          }
        } catch {}
      }
      for (const attr of ['data-testid', 'data-test-id', 'name']) {
        const val = ancestor.getAttribute(attr);
        if (val) {
          try {
            const attrSel = `[${attr}="${val.replace(/"/g, '\\"')}"]`;
            if (doc.querySelectorAll(attrSel).length === 1) {
              anchorSelector = attrSel;
              break;
            }
          } catch {}
        }
      }
      if (anchorSelector) break;
      ancestor = ancestor.parentElement;
    }

    if (ancestor && anchorSelector) {
      const relXpath = getRelativeXPath(el, ancestor);
      return `${anchorSelector} >> xpath=.//${relXpath}`;
    }

    // 6. Absolute Structural Fallback (CSS)
    let path = '';
    let current: any = el;
    while (current && current.nodeType === 1) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      const currentTag = current.tagName.toLowerCase();
      let hasSameTagSiblings = false;
      let nextSib = current.nextElementSibling;
      while (nextSib) {
        if (nextSib.tagName === current.tagName) {
          hasSameTagSiblings = true;
          break;
        }
        nextSib = nextSib.nextElementSibling;
      }
      const needsIndex = index > 1 || hasSameTagSiblings;
      const step = needsIndex ? `${currentTag}:nth-of-type(${index})` : currentTag;
      path = path ? `${step} > ${path}` : step;
      current = current.parentElement;
    }

    return path;
  });
}
