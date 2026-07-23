/**
 * Admin notification email (packet 10): "a guest submitted a batch of
 * photos, come review it." Sent once per batch to wedding@rachandzach.com
 * via src/lib/notifications/resend.ts's idempotent send path.
 */
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
  render,
} from "@react-email/components";

export interface NewUploadBatchEmailProps {
  displayName: string | null;
  itemCount: number;
  submittedAt: string | null;
}

function formatSubmittedAt(iso: string | null): string {
  if (!iso) return "just now";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function NewUploadBatchEmail({
  displayName,
  itemCount,
  submittedAt,
}: NewUploadBatchEmailProps) {
  const who = displayName?.trim() || "A guest";
  const photoWord = itemCount === 1 ? "photo" : "photos";
  const previewText = `${who} submitted ${itemCount} ${photoWord} for review`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={{ backgroundColor: "#f6f1ea", fontFamily: "Georgia, serif" }}>
        <Container
          style={{
            backgroundColor: "#ffffff",
            padding: "32px",
            margin: "24px auto",
            maxWidth: "480px",
            borderRadius: "8px",
          }}
        >
          <Heading style={{ color: "#3a3229", fontSize: "20px" }}>
            New photos to review
          </Heading>
          <Text style={{ color: "#3a3229", fontSize: "15px", lineHeight: "1.6" }}>
            {who} just submitted <strong>{itemCount}</strong> {photoWord} to
            the 0719 + co. gallery on {formatSubmittedAt(submittedAt)}.
          </Text>
          <Hr style={{ borderColor: "#e5ddd0" }} />
          <Text style={{ color: "#6b6155", fontSize: "13px" }}>
            Open the review queue in the admin gallery to approve or decline
            these photos.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default NewUploadBatchEmail;

/** Renders the email to a static HTML string for the Resend send call. */
export async function renderNewUploadBatchEmail(
  props: NewUploadBatchEmailProps,
): Promise<string> {
  return render(<NewUploadBatchEmail {...props} />);
}
