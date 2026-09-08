import Busboy from "busboy";
import { Readable } from "node:stream";
import { fail } from "./db.js";

// Stream each file in 5 MiB parts; a five-file request never buffers 250 MiB.
async function store(bucket, key, file, mime) {
  const multipart = await bucket.createMultipartUpload(key, {
      httpMetadata: { contentType: mime },
    }),
    parts = [];
  let chunks = [],
    length = 0,
    part = 1,
    total = 0;
  const flush = async (size = length) => {
    const bytes = Buffer.concat(chunks, length);
    parts.push(await multipart.uploadPart(part++, bytes.subarray(0, size)));
    const tail = bytes.subarray(size);
    chunks = tail.length ? [tail] : [];
    length = tail.length;
  };
  try {
    for await (const chunk of file) {
      total += chunk.length;
      if (total > 50 * 1048576) fail(413, "单个文件不能超过 50 MB");
      chunks.push(chunk);
      length += chunk.length;
      while (length >= 5 * 1048576) await flush(5 * 1048576);
    }
    if (file.truncated) fail(413, "单个文件不能超过 50 MB");
    if (length) await flush();
    if (!total) {
      await multipart.abort();
      await bucket.put(key, new Uint8Array());
    } else await multipart.complete(parts);
    return total;
  } catch (e) {
    await multipart.abort().catch(() => {});
    throw e;
  }
}
export async function uploads(request, bucket) {
  const fields = {},
    files = [],
    jobs = [];
  let problem;
  const parser = Busboy({
    headers: { "content-type": request.headers.get("content-type") },
    defParamCharset: "utf8",
    limits: {
      files: 5,
      fields: 12,
      fieldSize: 20000,
      fileSize: 50 * 1048576,
      parts: 17,
    },
  });
  parser.on("field", (name, value, info) => {
    if (info.valueTruncated)
      problem = Object.assign(new Error("表单文字过长"), { status: 413 });
    fields[name] = value;
  });
  parser.on("file", (field, file, info) => {
    const key = crypto.randomUUID();
    if (field !== "files") {
      file.resume();
      problem = Object.assign(new Error("附件字段无效"), { status: 400 });
      return;
    }
    jobs.push(
      store(bucket, key, file, info.mimeType)
        .then((size) =>
          files.push({
            id: crypto.randomUUID(),
            storage_key: key,
            name: info.filename,
            mime: info.mimeType,
            size,
          }),
        )
        .catch((error) => {
          problem = error;
        }),
    );
  });
  for (const event of ["filesLimit", "fieldsLimit", "partsLimit"])
    parser.on(event, () => {
      problem = Object.assign(new Error("最多上传 5 个文件"), { status: 413 });
    });
  try {
    await new Promise((resolve, reject) => {
      parser.on("close", resolve);
      parser.on("error", reject);
      Readable.fromWeb(request.body).on("error", reject).pipe(parser);
    });
    await Promise.all(jobs);
    if (problem) throw problem;
    return { fields, files };
  } catch (error) {
    await Promise.allSettled(jobs);
    await Promise.allSettled(files.map((f) => bucket.delete(f.storage_key)));
    throw error;
  }
}
