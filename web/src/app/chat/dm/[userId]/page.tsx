import { notFound } from "next/navigation";
import DmThread from "@/components/chat/DmThread";

export default async function DmPage({ params }: { params: Promise<{ userId: string }> }) {
  const userId = Number((await params).userId);
  if (!Number.isInteger(userId) || userId <= 0) notFound();
  return <DmThread userId={userId} />;
}
