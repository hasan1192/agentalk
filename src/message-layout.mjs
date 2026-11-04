// Offsets count UTF-16 code units, matching browser selection and JS strings.
export function messagePieces(content, attachments = []) {
  let cursor = 0;
  const pieces = [];
  for (const attachment of [...attachments].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0),
  )) {
    const position = attachment.position ?? 0;
    if (position > cursor)
      pieces.push({ type: "text", text: content.slice(cursor, position) });
    pieces.push({ type: "attachment", attachment });
    cursor = position;
  }
  if (cursor < content.length)
    pieces.push({ type: "text", text: content.slice(cursor) });
  return pieces;
}
export function attachmentPlacement(content, position) {
  const before = content.slice(0, position),
    after = content.slice(position);
  const line = before.split("\n").length;
  return {
    offset: position,
    beforeLine: before ? line - (before.endsWith("\n") ? 1 : 0) : null,
    afterLine: after ? line + (after.startsWith("\n") ? 1 : 0) : null,
    inline: Boolean(
      before && after && !before.endsWith("\n") && !after.startsWith("\n"),
    ),
  };
}
