import { TopNav } from "@/components/TopNav";
import { getCurrentProfile } from "@/lib/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  return (
    <div className="min-h-full">
      <TopNav profile={profile} />
      <main className="mx-auto max-w-[1440px] px-5 pb-24 md:px-10">{children}</main>
    </div>
  );
}
