import { TeacherInviteAccept } from "@/components/teacher-invite-accept";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function TeacherInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <><div className="fixed right-4 top-4 z-50"><ThemeToggle compact /></div><TeacherInviteAccept token={token} /></>;
}
