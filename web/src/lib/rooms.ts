// Keep in sync with backend/apps/chat/management/commands/seed_rooms.py.
// Static so landing and SEO pages build without the API running.

export type RegionRoom = { slug: string; name: string; city: string; timezone: string };
export type TopicRoom = { slug: string; name: string; blurb: string };

export const REGION_ROOMS: RegionRoom[] = [
  { slug: "us-west", name: "US West", city: "Los Angeles", timezone: "America/Los_Angeles" },
  { slug: "us-east", name: "US East & Canada", city: "New York", timezone: "America/New_York" },
  { slug: "latin-america", name: "Latin America", city: "São Paulo", timezone: "America/Sao_Paulo" },
  { slug: "uk-ireland", name: "UK & Ireland", city: "London", timezone: "Europe/London" },
  { slug: "europe", name: "Europe", city: "Berlin", timezone: "Europe/Berlin" },
  { slug: "africa", name: "Africa", city: "Lagos", timezone: "Africa/Lagos" },
  { slug: "middle-east", name: "Middle East", city: "Dubai", timezone: "Asia/Dubai" },
  { slug: "south-asia", name: "South Asia", city: "Mumbai", timezone: "Asia/Kolkata" },
  { slug: "southeast-asia", name: "Southeast Asia", city: "Manila", timezone: "Asia/Manila" },
  { slug: "australia-nz", name: "Australia & NZ", city: "Sydney", timezone: "Australia/Sydney" },
];

export const TOPIC_ROOMS: TopicRoom[] = [
  { slug: "random", name: "Random chat", blurb: "Anything goes (within the rules). The busiest room on vChat." },
  { slug: "late-night", name: "Late-night talks", blurb: "Can't sleep? Neither can they." },
  { slug: "music", name: "Music", blurb: "Share what's on repeat and find your next favourite song." },
  { slug: "gaming", name: "Gaming", blurb: "Find a squad, talk patch notes, argue about the best game ever." },
  { slug: "movies-tv", name: "Movies & TV", blurb: "What to watch next, and spoiler-free reviews." },
  { slug: "sports", name: "Sports", blurb: "Live match chat for every sport and every league." },
  { slug: "memes", name: "Memes", blurb: "Jokes, banter and the internet's latest obsession." },
  { slug: "students", name: "Students", blurb: "Exams, campus life and study buddies." },
  {
    slug: "someone-to-talk-to",
    name: "Need someone to talk to",
    blurb: "A calmer room for when you just need someone to listen.",
  },
];

export const ALL_ROOMS = [...REGION_ROOMS, ...TOPIC_ROOMS];

export function findRoom(slug: string) {
  return ALL_ROOMS.find((r) => r.slug === slug);
}
