import ChatRoom from "@/components/chat/ChatRoom";

export default async function ChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ChatRoom slug={slug} />;
}
