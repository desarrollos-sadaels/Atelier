import { TopNav } from "@/components/TopNav";
import { getCurrentProfile, getNotifications, getUnreadCount } from "@/lib/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [profile, notifications, unread] = await Promise.all([
    getCurrentProfile(),
    getNotifications(),
    getUnreadCount(),
  ]);
  return (
    <div className="min-h-full">
      <TopNav profile={profile} initialNotifications={notifications} initialUnread={unread} />
      <main className="mx-auto max-w-[1440px] px-5 pb-24 md:px-10">{children}</main>
    </div>
  );
}
