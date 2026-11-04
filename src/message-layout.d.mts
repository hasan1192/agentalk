import type { MediaAttachment } from "./types";
export function messagePieces<T extends MediaAttachment>(
  content: string,
  attachments?: T[],
): ({ type: "text"; text: string } | { type: "attachment"; attachment: T })[];
export function attachmentPlacement(
  content: string,
  position: number,
): {
  offset: number;
  beforeLine: number | null;
  afterLine: number | null;
  inline: boolean;
};
