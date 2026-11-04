// Atomic attachment nodes contribute one unit to cursor positions, no text to the message.
export function readEditor(root: HTMLElement, ignoreEmptyLine = true) {
  // Chromium leaves one padding BR when the editable is cleared. Prefix
  // fragments used for selection still count a real BR as one newline.
  if (
    ignoreEmptyLine &&
    !root.textContent &&
    !root.querySelector("[data-attachment-id],[data-composer-placeholder]") &&
    root.querySelectorAll("br").length === 1
  )
    return {
      text: "",
      positions: [] as { id: string; position: number }[],
      logical: 0,
    };
  let text = "",
    logical = 0;
  const positions: { id: string; position: number }[] = [];
  const visit = (node: Node) => {
    if (node instanceof HTMLElement && node.dataset.composerPlaceholder) return;
    if (node instanceof HTMLElement && node.dataset.attachmentId) {
      positions.push({ id: node.dataset.attachmentId, position: text.length });
      logical++;
    } else if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || "";
      logical += (node.textContent || "").length;
    } else if (node instanceof HTMLBRElement) {
      text += "\n";
      logical++;
    } else {
      const block =
        node instanceof HTMLElement && /^(DIV|P)$/.test(node.tagName);
      if (block && text && !text.endsWith("\n")) {
        text += "\n";
        logical++;
      }
      for (const child of node.childNodes) visit(child);
    }
  };
  for (const child of root.childNodes) visit(child);
  return { text, positions, logical };
}
export function editorCaret(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !root.contains(selection.anchorNode))
    return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(root);
  range.setEnd(selection.anchorNode!, selection.anchorOffset);
  const fragment = document.createElement("div");
  fragment.append(range.cloneContents());
  const value = readEditor(fragment, false);
  return { position: value.text.length, logical: value.logical };
}
export function editorSelection(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const offset = (node: Node, at: number) => {
    const prefix = document.createRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(node, at);
    const copy = document.createElement("div");
    copy.append(prefix.cloneContents());
    return readEditor(copy, false).logical;
  };
  return {
    start: offset(range.startContainer, range.startOffset),
    end: offset(range.endContainer, range.endOffset),
  };
}
export function selectEditor(root: HTMLElement, start: number, end = start) {
  const locate = (position: number): [Node, number] => {
    let left = position;
    for (let i = 0; i < root.childNodes.length; i++) {
      const child = root.childNodes[i];
      const length =
        child instanceof HTMLElement && child.dataset.composerPlaceholder
          ? 0
          : child instanceof HTMLElement && child.dataset.attachmentId
            ? 1
            : child instanceof HTMLBRElement
              ? 1
              : (child.textContent || "").length;
      if (left <= length) {
        if (child.nodeType === Node.TEXT_NODE) return [child, left];
        return [root, i + (left ? 1 : 0)];
      }
      left -= length;
    }
    return [root, root.childNodes.length];
  };
  const range = document.createRange(),
    a = locate(start),
    b = locate(end);
  range.setStart(...a);
  range.setEnd(...b);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
