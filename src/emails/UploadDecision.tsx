/**
 * Guest decision-receipt email (packet 10): sent once a submitted batch
 * reaches a terminal review state, ONLY when the guest supplied an email.
 * Deliberately generic: it never includes an admin's internal rejection
 * note, only a warm, honest summary of the outcome.
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

export type UploadDecisionStatus = "approved" | "partially_approved" | "rejected";

export interface UploadDecisionEmailProps {
  displayName: string | null;
  status: string;
  approvedCount: number;
  totalCount: number;
}

function headline(status: string): string {
  switch (status) {
    case "approved":
      return "Your photos are in the gallery!";
    case "partially_approved":
      return "Some of your photos are in the gallery";
    case "rejected":
      return "About your photo submission";
    default:
      return "An update on your photo submission";
  }
}

function body(props: UploadDecisionEmailProps): string {
  const { status, approvedCount, totalCount } = props;
  if (status === "approved") {
    return `All ${totalCount} of your ${totalCount === 1 ? "photo" : "photos"} were added to the 0719 + co. gallery. Thank you for sharing the weekend with us.`;
  }
  if (status === "partially_approved") {
    return `${approvedCount} of your ${totalCount} photos were added to the 0719 + co. gallery. Thank you for sharing the weekend with us.`;
  }
  // rejected -- generic, no internal moderation notes.
  return "We reviewed your submission and weren't able to add these photos to the gallery this time. Thank you for sharing the weekend with us all the same.";
}

export function UploadDecisionEmail(props: UploadDecisionEmailProps) {
  const who = props.displayName?.trim() || "there";

  return (
    <Html>
      <Head />
      <Preview>{headline(props.status)}</Preview>
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
            {headline(props.status)}
          </Heading>
          <Text style={{ color: "#3a3229", fontSize: "15px", lineHeight: "1.6" }}>
            Hi {who},
          </Text>
          <Text style={{ color: "#3a3229", fontSize: "15px", lineHeight: "1.6" }}>
            {body(props)}
          </Text>
          <Hr style={{ borderColor: "#e5ddd0" }} />
          <Text style={{ color: "#6b6155", fontSize: "13px" }}>
            With love, 0719 + co.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default UploadDecisionEmail;

/** Renders the email to a static HTML string for the Resend send call. */
export async function renderUploadDecisionEmail(
  props: UploadDecisionEmailProps,
): Promise<string> {
  return render(<UploadDecisionEmail {...props} />);
}
