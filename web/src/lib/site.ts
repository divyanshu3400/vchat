/**
 * Who runs vChat and how to reach them. The legal pages read everything from here, so a change
 * of name, address or officer is one edit.
 */
export const SITE = {
  name: "vChat",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://vchat.ssmm.online",
  operator: "Techyugantar",
  location: "India",
  supportEmail: "support@techyugantar.in",
  // Grievance Officer under India's IT Rules, 2021 (rule 3(2)).
  grievanceOfficer: "Grievance Officer, vChat",
  grievanceEmail: "support@techyugantar.in",
  lastUpdated: "16 November 2026",
  retention: {
    messages: "1 year",
    friendChatsDefault: "1 week",
    randomChats: "7 days",
    media: "1 year",
    reports: "2 years",
    ipLogs: "90 days",
  },
} as const;
