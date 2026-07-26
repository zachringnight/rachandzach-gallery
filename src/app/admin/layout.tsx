/**
 * Admin shell (packet 10). Every /admin server component tree must call
 * requireAdmin() itself (the proxy's cookie check is only a cheap structural
 * gate, per packet 04) -- this layout is the first of those calls, and every
 * page under it calls it again rather than trusting the layout ran first.
 *
 * A denied admin (no session, or a signed-in account that isn't
 * wedding@rachandzach.com) sees a plain explanation here instead of being
 * silently redirected into a guest-facing page: /admin never accepts a guest
 * session, and there is no admin sign-in form in this packet's scope (that
 * bootstrap -- requesting a Supabase magic link -- is packet 04's surface).
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { AdminAccessError, requireAdmin } from "@/lib/auth/admin-session";

export const metadata = {
  title: "0719 + co. | Admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  let admin: { userId: string; email: string } | null = null;
  let deniedMessage: string | null = null;

  try {
    admin = await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAccessError) {
      deniedMessage = error.message;
    } else {
      throw error;
    }
  }

  if (!admin) {
    return (
      <main
        className="flex min-h-screen items-center justify-center px-6"
        style={{ backgroundColor: "var(--color-cream)", fontFamily: "var(--font-body)" }}
      >
        <div
          className="flex max-w-md flex-col gap-3 border px-8 py-8 text-center"
          style={{
            borderColor: "var(--color-sand)",
            borderRadius: "var(--radius-card)",
            backgroundColor: "var(--color-white)",
          }}
        >
          <h1
            className="text-xl font-semibold"
            style={{ color: "var(--color-ink)", fontFamily: "var(--font-display)" }}
          >
            Admin access required
          </h1>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            {deniedMessage}
          </p>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            Sign in with the wedding@rachandzach.com magic link, then reload
            this page.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: "var(--color-cream)", fontFamily: "var(--font-body)" }}
    >
      <header
        className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4"
        style={{ borderColor: "var(--color-sand)", backgroundColor: "var(--color-white)" }}
      >
        <div className="flex items-baseline gap-3">
          <span
            className="text-lg font-semibold"
            style={{ color: "var(--color-ink)", fontFamily: "var(--font-display)" }}
          >
            0719 + co.
          </span>
          <span className="text-sm" style={{ color: "var(--color-muted)" }}>
            Admin
          </span>
        </div>
        <nav className="flex items-center gap-4 text-sm" style={{ color: "var(--color-ink)" }}>
          <Link href="/admin/review">Review queue</Link>
          <Link href="/admin/catalog">Catalog tags</Link>
          <Link href="/admin/faces">Guests &amp; faces</Link>
          <Link href="/admin/memories">Memory notes</Link>
          <span style={{ color: "var(--color-muted)" }}>{admin.email}</span>
        </nav>
      </header>
      <div className="px-6 py-8">{children}</div>
    </div>
  );
}
