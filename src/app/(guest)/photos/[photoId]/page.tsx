import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGalleryDataSource } from "@/lib/gallery/supabase-source";
import { getPhotoDetail } from "@/lib/gallery/query";
import { serializePhotoDetail } from "@/lib/gallery/serialize";
import { PhotoDetailView } from "@/components/gallery/PhotoDetailView";

export const dynamic = "force-dynamic";

/**
 * Deep link to a single photo. Guests reach this via a shared URL or the
 * lightbox permalink. Access is enforced by the (guest) layout; a pending,
 * hidden, or unknown id resolves to a 404 (never leaking that it exists).
 */
export default async function PhotoDetailPage({
  params,
}: {
  params: Promise<{ photoId: string }>;
}) {
  const { photoId } = await params;
  const client = createAdminClient();
  const source = createSupabaseGalleryDataSource(client);

  const detail = await getPhotoDetail(photoId, source);
  if (!detail) notFound();

  const data = await serializePhotoDetail(detail, client);
  return <PhotoDetailView detail={data} />;
}
