/**
 * Unsent text per chat ("dm:12", "room:lobby"…), kept on this device so it survives switching
 * chats and reloading. Only the most recent MAX drafts are kept.
 */
const STORE = "vchat.drafts";
const MAX = 50;

function all(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}");
  } catch {
    return {};
  }
}

export function readDraft(key: string | undefined): string {
  if (!key) return "";
  return all()[key] ?? "";
}

export function writeDraft(key: string | undefined, text: string) {
  if (!key) return;
  try {
    const drafts = all();
    delete drafts[key];
    if (text.trim()) drafts[key] = text;
    const keys = Object.keys(drafts);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete drafts[k];
    localStorage.setItem(STORE, JSON.stringify(drafts));
  } catch {
    /* private mode: drafts last only while the chat is open */
  }
}
