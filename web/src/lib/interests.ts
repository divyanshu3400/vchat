/** Interests for random chat (the server keeps the same list in apps/stranger/matchmaker.py). */
export const INTERESTS: { slug: string; label: string; emoji: string }[] = [
  { slug: "music", label: "Music", emoji: "🎵" },
  { slug: "movies", label: "Movies", emoji: "🎬" },
  { slug: "cricket", label: "Cricket", emoji: "🏏" },
  { slug: "football", label: "Football", emoji: "⚽" },
  { slug: "gaming", label: "Gaming", emoji: "🎮" },
  { slug: "anime", label: "Anime", emoji: "🍥" },
  { slug: "books", label: "Books", emoji: "📚" },
  { slug: "travel", label: "Travel", emoji: "✈️" },
  { slug: "food", label: "Food", emoji: "🍜" },
  { slug: "fitness", label: "Fitness", emoji: "💪" },
  { slug: "tech", label: "Tech", emoji: "💻" },
  { slug: "art", label: "Art", emoji: "🎨" },
  { slug: "memes", label: "Memes", emoji: "😂" },
  { slug: "study", label: "Study", emoji: "📖" },
  { slug: "pets", label: "Pets", emoji: "🐾" },
  { slug: "fashion", label: "Fashion", emoji: "👗" },
];
export const MAX_INTERESTS = 5;

const QUESTIONS: Record<string, string[]> = {
  music: ["What song have you had on repeat lately?", "Which singer would you see live if you could pick anyone?"],
  movies: ["What's the best movie you saw this year?", "Which film can you watch again and again?"],
  cricket: ["Who's your all-time favourite cricketer?", "Best match you ever watched?"],
  football: ["Which club do you support, and why?", "Messi or Ronaldo, and no fence-sitting!"],
  gaming: ["What are you playing these days?", "Which game would you recommend to a beginner?"],
  anime: ["Which anime got you into anime?", "Who's the best anime character ever written?"],
  books: ["What's the last book you couldn't put down?", "Which book should everyone read once?"],
  travel: ["Best place you've ever been to?", "Where's the next trip on your list?"],
  food: ["What's the one dish you could eat every day?", "Street food or a fancy restaurant?"],
  fitness: ["Gym, running or yoga?", "What keeps you going on lazy days?"],
  tech: ["Which app could you not live without?", "Android or iPhone, and why?"],
  art: ["What do you like to draw or make?", "Which artist do you love?"],
  memes: ["Send your best meme description, go!", "Which meme never gets old for you?"],
  study: ["What are you studying?", "Best study trick you know?"],
  pets: ["Dogs or cats?", "Tell me about your pet (or dream pet)!"],
  fashion: ["What's your style in three words?", "Favourite brand or shop?"],
};
const GENERAL = [
  "What's something that made you smile today?",
  "If you could live anywhere for a year, where would it be?",
  "What's a small thing you're really good at?",
  "Night owl or early bird?",
  "What's the best advice anyone gave you?",
];

export function interestLabel(slug: string) {
  const i = INTERESTS.find((x) => x.slug === slug);
  return i ? `${i.emoji} ${i.label}` : slug;
}

/** A conversation starter: about something you both like, or a general one. */
export function iceBreaker(common: string[], skip?: string): string {
  const pool = [...common.flatMap((c) => QUESTIONS[c] ?? []), ...(common.length ? [] : GENERAL)];
  const choices = pool.filter((q) => q !== skip);
  const list = choices.length ? choices : GENERAL;
  return list[Math.floor(Math.random() * list.length)];
}

const STORE = "vchat.interests";

export function savedInterests(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || "[]");
    return Array.isArray(v) ? v.filter((s) => INTERESTS.some((i) => i.slug === s)).slice(0, MAX_INTERESTS) : [];
  } catch {
    return [];
  }
}

export function saveInterests(list: string[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}
