// Immutable display-derivative policy and generator.
//
// Policy (packet 02):
//  - Widths 480, 960, 1600, 2400 -- only when strictly smaller than the source width.
//  - AVIF + WebP at 480/960/1600; high-quality JPEG at 2400 for compatibility.
//  - Object path previews/{imageDataHash}/{width}.{format} with
//    Cache-Control public,max-age=31536000,immutable.
//  - "Original" always means the source JPEG; derivatives are display copies.
//
// Generation is staged: every output is written into a task-specific temporary
// directory, fully decoded and dimension-checked, and only then atomically
// renamed into previews/. The source file is never opened for writing.
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";

export const DERIVATIVE_WIDTHS = [480, 960, 1600, 2400];
export const MULTI_FORMAT_WIDTHS = [480, 960, 1600];
export const JPEG_COMPAT_WIDTH = 2400;
export const CACHE_CONTROL = "public,max-age=31536000,immutable";

const QUALITY = { avif: 55, webp: 78, jpeg: 90 };

/**
 * Plans derivatives from source dimensions. Never upscales.
 * @param {{imageDataHash: string, width: number, height: number}} photo
 * @returns {Array<{imageDataHash:string,width:number,height:number,format:"avif"|"webp"|"jpeg",objectPath:string,cacheControl:string,quality:number}>}
 */
export function buildDerivativePlan(photo) {
  const plan = [];
  const push = (width, format) => {
    plan.push({
      imageDataHash: photo.imageDataHash,
      width,
      height: Math.max(1, Math.round((photo.height * width) / photo.width)),
      format,
      objectPath: `previews/${photo.imageDataHash}/${width}.${format}`,
      cacheControl: CACHE_CONTROL,
      quality: QUALITY[format]
    });
  };
  for (const width of MULTI_FORMAT_WIDTHS) {
    if (width < photo.width) {
      push(width, "avif");
      push(width, "webp");
    }
  }
  if (JPEG_COMPAT_WIDTH < photo.width) {
    push(JPEG_COMPAT_WIDTH, "jpeg");
  }
  return plan;
}

async function encodeDerivative(basePipeline, plan, stagingPath) {
  let pipeline = basePipeline
    .clone()
    .resize({ width: plan.width, withoutEnlargement: true });
  if (plan.format === "avif") {
    pipeline = pipeline.avif({ quality: plan.quality });
  } else if (plan.format === "webp") {
    pipeline = pipeline.webp({ quality: plan.quality });
  } else {
    pipeline = pipeline.jpeg({ quality: plan.quality, mozjpeg: true });
  }
  await pipeline.toFile(stagingPath);
}

/**
 * Decodes a derivative and measures BOTH dimensions against the plan.
 * Outputs are generated with autoOrient so rotation is baked into pixels, but
 * if an Orientation tag somehow survives we still measure display dimensions.
 * Returns the measured (display) width and height so callers record what was
 * actually produced, never the planned numbers.
 */
async function verifyDerivative(path, plan) {
  const image = sharp(path, { failOn: "error" });
  const metadata = await image.metadata();
  const tagOrientation = metadata.orientation ?? 1;
  const swapped = tagOrientation >= 5 && tagOrientation <= 8;
  const width = swapped ? metadata.height : metadata.width;
  const height = swapped ? metadata.width : metadata.height;
  if (width !== plan.width) {
    throw new Error(
      `Derivative ${plan.objectPath} decoded to width ${width}, expected ${plan.width}`
    );
  }
  // Planned height uses Math.round over the oriented source aspect ratio;
  // sharp's own rounding may land one pixel off, so allow exactly that.
  if (!Number.isInteger(height) || height < 1 || Math.abs(height - plan.height) > 1) {
    throw new Error(
      `Derivative ${plan.objectPath} decoded to height ${height}, expected ${plan.height} (+/-1)`
    );
  }
  // Force a full decode so truncated or corrupt output cannot be published.
  await image.stats();
  return { width, height };
}

function derivativeObject(plan, measured, bytes) {
  return {
    objectPath: plan.objectPath,
    width: measured.width,
    height: measured.height,
    format: plan.format,
    cacheControl: plan.cacheControl,
    bytes
  };
}

/**
 * Generates every planned derivative for one photo.
 * Writes to a temporary staging directory inside outputRoot, verifies each
 * output decodes at the planned dimensions (both axes, measured), then
 * atomically renames into previews/{imageDataHash}/. On any failure nothing
 * is published and the staging directory is removed. The source is read-only
 * throughout. Emitted objects carry MEASURED dimensions, not planned ones.
 *
 * With options.incremental, an already-published output that decodes fully at
 * the planned dimensions is reused instead of regenerated; anything missing,
 * corrupt, or dimension-mismatched is regenerated through the same staged and
 * verified path. Reused count is returned as `reused`.
 *
 * @param {{imageDataHash:string,width:number,height:number}} photo
 * @param {string} sourcePath Absolute path to the source JPEG (never written).
 * @param {string} outputRoot Directory that will contain previews/.
 * @param {{incremental?: boolean}} [options]
 * @returns {Promise<{objects: Array<{objectPath:string,width:number,height:number,format:string,cacheControl:string,bytes:number}>, reused: number}>}
 */
export async function generateDerivatives(photo, sourcePath, outputRoot, options = {}) {
  const { incremental = false } = options;
  const plans = buildDerivativePlan(photo);
  if (plans.length === 0) {
    return { objects: [], reused: 0 };
  }

  await fs.mkdir(outputRoot, { recursive: true });

  const objectsByPath = new Map();
  const pending = [];
  if (incremental) {
    for (const plan of plans) {
      const finalPath = join(outputRoot, plan.objectPath);
      try {
        const measured = await verifyDerivative(finalPath, plan);
        const bytes = (await fs.stat(finalPath)).size;
        objectsByPath.set(plan.objectPath, derivativeObject(plan, measured, bytes));
      } catch {
        pending.push(plan);
      }
    }
  } else {
    pending.push(...plans);
  }

  if (pending.length > 0) {
    const stagingDir = await fs.mkdtemp(join(outputRoot, ".tmp-derivatives-"));
    try {
      // Auto-orient bakes EXIF rotation into pixels (metadata-free formats keep
      // the correct orientation); keepIccProfile preserves the embedded ICC intent.
      const basePipeline = sharp(sourcePath, { failOn: "error" })
        .autoOrient()
        .keepIccProfile();

      const staged = [];
      for (const plan of pending) {
        const stagingPath = join(stagingDir, `${plan.width}.${plan.format}`);
        await encodeDerivative(basePipeline, plan, stagingPath);
        const measured = await verifyDerivative(stagingPath, plan);
        staged.push({ plan, stagingPath, measured, bytes: (await fs.stat(stagingPath)).size });
      }

      // Every output verified; publish with atomic renames.
      for (const { plan, stagingPath, measured, bytes } of staged) {
        const finalPath = join(outputRoot, plan.objectPath);
        await fs.mkdir(dirname(finalPath), { recursive: true });
        await fs.rename(stagingPath, finalPath);
        objectsByPath.set(plan.objectPath, derivativeObject(plan, measured, bytes));
      }
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
    }
  }

  return {
    objects: plans.map((plan) => objectsByPath.get(plan.objectPath)),
    reused: plans.length - pending.length
  };
}
