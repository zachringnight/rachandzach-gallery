/**
 * GET /api/uploads/batches/[batchId]/status (packet 08). Returns state + counts
 * for a batch, scoped to the receipt token. The receipt travels as the `receipt`
 * query param or the `x-upload-receipt` header; it is an opaque, non-identifying
 * code. A wrong token and a missing batch both return 404, so the endpoint
 * cannot enumerate other guests' batches. Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getUploadStatus } from "@/lib/uploads/create-batch";
import { uploadErrorResponse } from "@/lib/uploads/http";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await context.params;
  const receiptToken =
    request.nextUrl.searchParams.get("receipt") ??
    request.headers.get("x-upload-receipt");
  if (!receiptToken) {
    return NextResponse.json(
      { error: "A receipt token is required." },
      { status: 400 },
    );
  }

  try {
    const status = await getUploadStatus(batchId, receiptToken);
    if (!status) {
      return NextResponse.json(
        { error: "No matching upload was found." },
        { status: 404 },
      );
    }
    return NextResponse.json(status, { status: 200 });
  } catch (error) {
    return uploadErrorResponse(error);
  }
}
