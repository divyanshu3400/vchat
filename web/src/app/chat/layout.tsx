import type { Metadata } from "next";
import ChatProvider from "@/components/chat/ChatProvider";
import ChatShell from "@/components/chat/ChatShell";

// Live chat and DMs are private, changing content: keep every /chat page out of search results.
export const metadata: Metadata = { title: "Chat", robots: { index: false, follow: false } };

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChatProvider>
      <ChatShell>{children}</ChatShell>
    </ChatProvider>
  );
}
