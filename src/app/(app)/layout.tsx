import { TopNav } from "@/components/TopNav";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full">
      <TopNav />
      <main className="mx-auto max-w-[1440px] px-5 pb-24 md:px-10">{children}</main>
    </div>
  );
}
