/** A GIF travels in a message as "gif:<id>:<w>x<h>" (checked by the server, apps/gifs). */
const GIF_RE = /^gif:([A-Za-z0-9]{4,64}):(\d{1,4})x(\d{1,4})$/;

export type GifRef = { id: string; w: number; h: number };

export function parseGif(text: string | null | undefined): GifRef | null {
  const m = GIF_RE.exec(text ?? "");
  return m ? { id: m[1], w: Number(m[2]), h: Number(m[3]) } : null;
}

export function gifText(g: GifRef) {
  return `gif:${g.id}:${g.w}x${g.h}`;
}

/** In chat bubbles and the picker (200 px wide). */
export function gifSmall(id: string) {
  return `https://media.giphy.com/media/${id}/200w.webp`;
}

/** Tapped: the full one. */
export function gifFull(id: string) {
  return `https://media.giphy.com/media/${id}/giphy.webp`;
}

/** How a message reads in previews. */
export function gifLabel(text: string) {
  return parseGif(text) ? "🎞️ GIF" : text;
}
