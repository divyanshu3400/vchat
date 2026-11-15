import { notFound } from "next/navigation";
import DmConversation from "@/components/chat/DmConversation";

export default async function DmPage({ params }: { params: Promise<{ userId: string }> }) {
  const userId = Number((await params).userId);
  if (!Number.isInteger(userId) || userId <= 0) notFound();
  return <DmConversation userId={userId} />;
}
