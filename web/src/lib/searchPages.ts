/**
 * Pages written for what people type into Google ("talk to strangers india", "hindi chat room"…).
 * Each one says plainly what vChat does for that need and sends people straight in. Keep every
 * claim true to the app: when a feature changes, change the words here too.
 *
 * Served at /<slug> by app/[topic]/page.tsx and listed in the sitemap.
 */

export type SearchPage = {
  slug: string;
  /** <title>, under ~60 characters; " · vChat" is added. */
  title: string;
  /** Meta description, ~150 characters. */
  description: string;
  eyebrow: string;
  h1: string;
  lede: string;
  cta: { label: string; href: string };
  second?: { label: string; href: string };
  /** Live "N chatting now" for this room, if the page is about one. */
  room?: string;
  points: { title: string; text: string }[];
  sections: { h2: string; paras: string[] }[];
  faq: [string, string][];
  related: string[];
};

/** When these pages' words last changed (the sitemap's lastmod). */
export const SEARCH_PAGES_UPDATED = "2026-11-17";

const RANDOM = { label: "Start a random chat", href: "/?go=stranger#join" };

export const SEARCH_PAGES: SearchPage[] = [
  {
    slug: "talk-to-strangers-india",
    title: "Talk to Strangers in India, Free & Anonymous",
    description:
      "Talk to strangers from India and around the world, free and anonymous. No login, no phone number. Pick a name, chat one-on-one, keep the good ones as friends.",
    eyebrow: "India · free · 18+",
    h1: "Talk to strangers in India",
    lede: "Pick a name and you're talking to someone new in seconds. No login, no phone number, no app to install. Just you, someone new, and a chat.",
    cta: RANDOM,
    second: { label: "Join the South Asia room", href: "/?room=south-asia#join" },
    room: "south-asia",
    points: [
      { title: "No login, no number", text: "Pick a name and start. Save the account later with a username and a password, only if you want to." },
      { title: "One-on-one or a room", text: "Random chat matches you with one person. Rooms like South Asia and Hindi & Hinglish are group chats." },
      { title: "Keep the good ones", text: "Liked talking? Send a friend request. Friends can share photos, call and pick up the chat any time." },
      { title: "Safe by design", text: "Nobody sees your real name or number. Block or report anyone in one tap; moderators check reports." },
    ],
    sections: [
      {
        h2: "How talking to strangers works here",
        paras: [
          "Tap Start, pick your interests if you like (music, cricket, movies, gaming…), and vChat finds someone online. People who like the same things are matched first, and an opening question helps you say hi.",
          "Don't like the vibe? Tap Next and you're talking to someone else. When a chat ends, it's gone from your screen. Random chats are kept 7 days only so reports can be checked.",
        ],
      },
      {
        h2: "Made for India, open to everyone",
        paras: [
          "Chat in English, Hindi or Hinglish, whatever comes naturally. The South Asia room shows Indian time and fills up in the evenings; the Hindi & Hinglish room is for chatting in your own language.",
          "It works the same on a cheap Android phone and a laptop, and you can add it to your home screen like an app.",
        ],
      },
    ],
    faq: [
      ["Is it free to talk to strangers on vChat?", "Yes. Random chat, rooms, friends, messages and calls are all free."],
      ["Do I need to give my phone number?", "No. You only pick a name. There is no phone number and no email needed."],
      ["Can strangers see who I am?", "No. In a random chat neither of you sees the other's name. Only friends see your name and photo."],
      ["Is it only for people in India?", "No. Anyone 18 or older can join from anywhere. You'll often meet people from India and South Asia, and others from around the world."],
    ],
    related: ["hindi-chat-room", "random-chat", "make-friends-online"],
  },
  {
    slug: "hindi-chat-room",
    title: "Hindi Chat Room: Chat in Hindi & Hinglish",
    description:
      "A free Hindi chat room for Hindi and Hinglish speakers. No login needed: pick a name and baat shuru karo. Make friends, talk late into the night, stay anonymous.",
    eyebrow: "Hindi & Hinglish · free · 18+",
    h1: "Hindi chat room",
    lede: "Apni bhasha mein baat karo: Hindi, Hinglish, ya jo bhi chale. Free hai, login nahi chahiye. Naam chuno aur room mein aa jao.",
    cta: { label: "Join the Hindi & Hinglish room", href: "/?room=hindi#join" },
    second: RANDOM,
    room: "hindi",
    points: [
      { title: "Hindi, Hinglish, English", text: "Type the way you talk. Roman Hindi (Hinglish) and Devanagari both work." },
      { title: "Login nahi chahiye", text: "Bas ek naam chuno. Account save karna ho to baad mein username aur password se." },
      { title: "Dost banao", text: "Kisi se achhi baat hui? Friend request bhejo. Friends photos bhej sakte hain aur call kar sakte hain." },
      { title: "Safe rehna aasaan", text: "Koi pareshaan kare to ek tap mein block ya report. Apna number ya address kabhi share mat karo." },
    ],
    sections: [
      {
        h2: "Ek room, apni bhasha",
        paras: [
          "Hindi & Hinglish room un logon ke liye hai jo apni zubaan mein baat karna pasand karte hain. Movies, cricket, music, college, kaam, ya bas time pass: sab chalega, bas rules ka dhyan rakho.",
          "Group chat se zyada personal baat karni ho to random chat try karo: ek-ek karke naye logon se milo, aur pasand na aaye to Next.",
        ],
      },
      {
        h2: "Rules simple hain",
        paras: [
          "18+ only. Gaali-galoch, harassment, ganda content aur paise maangna allowed nahi. Spam apne aap filter hota hai aur moderators reports dekhte hain.",
        ],
      },
    ],
    faq: [
      ["Kya Hindi chat room free hai?", "Haan, poori tarah free. Room, random chat, friends aur calls, sab free hain."],
      ["Login ya phone number chahiye?", "Nahi. Bas ek naam chuno. Number ya email nahi chahiye."],
      ["Kya Hinglish mein likh sakte hain?", "Haan. Hindi (Devanagari), Hinglish aur English, teeno chalte hain."],
      ["Kya meri pehchaan dikhegi?", "Nahi. Room mein sirf aapka chuna hua naam dikhta hai. Photo sirf friends ko dikhti hai."],
    ],
    related: ["talk-to-strangers-india", "late-night-chat", "make-friends-online"],
  },
  {
    slug: "anonymous-chat-no-login",
    title: "Anonymous Chat Without Login or Sign-Up",
    description:
      "Chat anonymously without login, sign-up, email or phone number. Pick a name and talk to strangers one-on-one or in rooms. Free, private and 18+.",
    eyebrow: "No sign-up · no email · 18+",
    h1: "Anonymous chat without login",
    lede: "No sign-up form, no email, no phone number. Pick a name and you're chatting. Nobody sees who you really are unless you decide to tell them.",
    cta: RANDOM,
    second: { label: "Browse rooms", href: "/#rooms" },
    points: [
      { title: "Nothing to fill in", text: "One name and a tick to confirm you're 18 or older. That's the whole sign-up." },
      { title: "Anonymous by default", text: "Random chats hide both names. Your photo is shown only to people you add as friends." },
      { title: "Keep it if you like it", text: "Save the account later with a username and a password. Add an email only if you want password resets." },
      { title: "You're in control", text: "Turn off being findable, hide your online status and read receipts, and delete your account any time." },
    ],
    sections: [
      {
        h2: "What \"anonymous\" means on vChat",
        paras: [
          "You choose the name people see. In a random chat, neither side sees the other's name at all, just \"Anonymous\". Your email (if you ever add one) is never shown to anyone.",
          "Random chats aren't saved for you. They're kept 7 days only so reports can be checked, then deleted. Chats with friends delete themselves after a time you choose, from one day to a year.",
        ],
      },
      {
        h2: "Anonymous, not lawless",
        paras: [
          "Every chat has a report button, automatic spam filters and moderators. Breaking the rules gets accounts and devices banned. Being anonymous protects you; it doesn't protect people who harass others.",
        ],
      },
    ],
    faq: [
      ["Can I chat without creating an account?", "Yes. You chat as a guest with just a name. Saving the account is optional."],
      ["Is my IP address or phone shown to others?", "No. Other people never see your IP, email or phone. They see only the name you picked."],
      ["What happens to my chats?", "Random chats are deleted after 7 days. Friend chats delete after the time you set. You can also delete your account."],
      ["Do I have to be 18?", "Yes. vChat is for adults only, 18 and older."],
    ],
    related: ["random-chat", "talk-to-strangers-india", "late-night-chat"],
  },
  {
    slug: "late-night-chat",
    title: "Late Night Chat: Talk to Someone When You Can't Sleep",
    description:
      "Can't sleep? Late night chat with people who are awake too. Free, anonymous, no login. Join the late-night room or get matched one-on-one in seconds.",
    eyebrow: "Late night · free · 18+",
    h1: "Late night chat",
    lede: "Awake at 2 a.m. and nobody to text? Someone else is awake too. Join the late-night room or get matched with one person to talk to.",
    cta: { label: "Join Late-night talks", href: "/?room=late-night#join" },
    second: RANDOM,
    room: "late-night",
    points: [
      { title: "People are up", text: "The late-night room and random chat stay busy when everyone else is asleep." },
      { title: "One-on-one", text: "Prefer a real conversation over a busy room? Random chat matches you with one person." },
      { title: "No pressure", text: "No profile to fill in. Leave whenever you want, or tap Next to talk to someone else." },
      { title: "Need to talk?", text: "The \"Need someone to talk to\" room is calmer, for when you just want someone to listen." },
    ],
    sections: [
      {
        h2: "Somewhere to go when you can't sleep",
        paras: [
          "Late-night talks is a group room for night owls: random thoughts, music at 3 a.m., overthinking, or just company. Random chat is better for a longer one-on-one conversation.",
          "If you're going through something heavy, the \"Need someone to talk to\" room is quieter. vChat isn't a helpline: if you're in danger or thinking about hurting yourself, contact local emergency services or a crisis line right away.",
        ],
      },
    ],
    faq: [
      ["Is anyone online late at night?", "Yes. Late night is one of the busiest times, especially in the late-night room and random chat."],
      ["Do I need an account?", "No. Pick a name and you're in."],
      ["Is it free?", "Yes, completely free."],
      ["Is it a mental health service?", "No. It's a place to talk to people. For a crisis, contact local emergency services or a crisis helpline."],
    ],
    related: ["hindi-chat-room", "make-friends-online", "anonymous-chat-no-login"],
  },
  {
    slug: "make-friends-online",
    title: "Make Friends Online: Meet New People, Free",
    description:
      "Make friends online by chatting with new people who like what you like. Match by interests, keep the good ones as friends, then chat, call and share photos. Free.",
    eyebrow: "Friends · free · 18+",
    h1: "Make friends online",
    lede: "Meet someone new, find out you both love the same music or the same team, and keep talking tomorrow. That's how friendships start here.",
    cta: RANDOM,
    second: { label: "Browse topic rooms", href: "/#rooms" },
    points: [
      { title: "Matched by interests", text: "Pick up to five interests. People who like the same things are matched with you first." },
      { title: "From stranger to friend", text: "Send a friend request from any chat. Once accepted, you see each other's names and keep chatting." },
      { title: "More than text", text: "Friends can share photos, send voice notes, call, video call and watch YouTube together." },
      { title: "Your own room", text: "Make a private room and share its link with your friends. Only people with the link can join." },
    ],
    sections: [
      {
        h2: "How a chat turns into a friendship",
        paras: [
          "Start in random chat or a topic room (music, gaming, sports, students, movies…). If you click with someone, add them as a friend. Your chat moves to Chats and stays there.",
          "Friends see your profile photo and your @username, so you can find each other again. Everyone else only sees the name you chose.",
        ],
      },
      {
        h2: "Rooms for what you're into",
        paras: [
          "Topic rooms are group chats for shared interests, and region rooms are for people near you. Make your own private room when you want a space just for your group.",
        ],
      },
    ],
    faq: [
      ["How do I add someone as a friend?", "Tap Add in any chat. When they accept, they're in your friends and the chat continues in Chats."],
      ["Can I find a friend by username?", "Yes. Search for @username in Chats to find people who saved their account."],
      ["Is making friends on vChat free?", "Yes. Chatting, friends, calls and private rooms are free."],
      ["Can I make a group with my friends?", "Yes. Create a private room and share the invite link. Only people with the link can join."],
    ],
    related: ["talk-to-strangers-india", "random-chat", "hindi-chat-room"],
  },
  {
    slug: "random-chat",
    title: "Random Chat: Meet Someone New, One-on-One",
    description:
      "Free random chat with strangers, one-on-one and anonymous. Get matched by interests, skip anytime with Next, and keep the good ones as friends. No login needed.",
    eyebrow: "One-on-one · free · 18+",
    h1: "Random chat with strangers",
    lede: "One tap, one new person. Chat anonymously, skip with Next when it's not a fit, and keep the people you click with.",
    cta: RANDOM,
    second: { label: "Join the Random room", href: "/?room=random#join" },
    room: "random",
    points: [
      { title: "Instant match", text: "Tap Start and you're connected with someone online, usually within seconds." },
      { title: "Interests first", text: "Pick interests and people who like the same things are matched with you first." },
      { title: "An opener ready", text: "Not sure what to say? Every chat starts with a question you can send in one tap." },
      { title: "Voice when you both want it", text: "Ask for a voice call; it starts only if the other person accepts. Your number stays private." },
    ],
    sections: [
      {
        h2: "How random chat works",
        paras: [
          "Pick a name, tap Start, and vChat finds someone who's also looking. Neither of you sees the other's name. Chat as long as you like; tap Next to meet someone else, or End to stop.",
          "Closing the page doesn't end the chat: come back and pick up where you left off, until one of you ends it.",
        ],
      },
      {
        h2: "Staying safe with strangers",
        paras: [
          "Don't share your phone number, address, social accounts or money with someone you just met. vChat warns you if you're about to share contact details, and you can report and leave in one tap.",
        ],
      },
    ],
    faq: [
      ["Is random chat free?", "Yes. Random chat is free, with no limit on how many people you meet."],
      ["Can I choose who I'm matched with?", "You can pick interests, and people with the same interests are matched first. Matching is otherwise random."],
      ["Can I video call in random chat?", "No. Random chat offers voice calls that start only if both accept. Video calls are for friends."],
      ["What if someone is rude?", "Tap the shield to report and leave, or block them. Moderators review every report."],
    ],
    related: ["talk-to-strangers-india", "anonymous-chat-no-login", "make-friends-online"],
  },
];

export function findSearchPage(slug: string) {
  return SEARCH_PAGES.find((p) => p.slug === slug);
}
