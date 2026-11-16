import JoinInviteScreen from "@/components/chat/rooms/JoinInviteScreen";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <JoinInviteScreen code={code} />;
}
