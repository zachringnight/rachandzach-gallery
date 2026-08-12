import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const tracePath = path.resolve(
  ".next/server/app/api/search/route.js.nft.json",
);

if (!existsSync(tracePath)) {
  throw new Error(
    `Moment Search trace is missing at ${tracePath}; run npm run verify:build first.`,
  );
}

const trace = JSON.parse(await readFile(tracePath, "utf8"));
if (!Array.isArray(trace.files)) {
  throw new Error(`Moment Search trace has no files array: ${tracePath}`);
}

const normalizedFiles = trace.files.map((file) =>
  path.resolve(path.dirname(tracePath), file).replaceAll("\\", "/"),
);
const runtimeSegment =
  `/node_modules/onnxruntime-node/bin/napi-v6/${process.platform}/${process.arch}/`;
const runtimeFiles = normalizedFiles.filter((file) =>
  file.includes(runtimeSegment),
);
const binding = runtimeFiles.find((file) =>
  file.endsWith("/onnxruntime_binding.node"),
);
const sharedLibraryPattern =
  process.platform === "darwin"
    ? /\/libonnxruntime(?:\.[\d.]+)?\.dylib$/
    : process.platform === "win32"
      ? /\/onnxruntime\.dll$/
      : /\/libonnxruntime\.so(?:\.[\d.]+)*$/;
const sharedLibrary = runtimeFiles.find((file) =>
  sharedLibraryPattern.test(file),
);

if (!binding || !existsSync(binding)) {
  throw new Error(
    `Moment Search trace omitted the ${process.platform}/${process.arch} ONNX binding.`,
  );
}
if (!sharedLibrary || !existsSync(sharedLibrary)) {
  throw new Error(
    `Moment Search trace omitted the ${process.platform}/${process.arch} ONNX shared library.`,
  );
}

const leakedCacheFiles = normalizedFiles.filter(
  (file) =>
    file.includes("/node_modules/@huggingface/transformers/.cache/") ||
    file.endsWith("/text_model.onnx"),
);
if (leakedCacheFiles.length > 0) {
  throw new Error(
    `Moment Search trace bundled a local model cache:\n${leakedCacheFiles.join("\n")}`,
  );
}

console.log(
  `Moment Search runtime trace verified for ${process.platform}/${process.arch}.`,
);
