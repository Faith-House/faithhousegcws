import { problem } from "./workbench-data.mjs";
export async function inspectArchive(
  data,
  {
    maxEntries = 2000,
    maxTotal = 48 * 1024 * 1024,
    maxEntry = 12 * 1024 * 1024,
  } = {},
) {
  const yauzl = (await import("yauzl")).default;
  const zip = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      data,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) =>
        error
          ? reject(problem("That archive could not be read."))
          : resolve(zip),
    ),
  );
  let count = 0,
    total = 0;
  try {
    return await new Promise((resolve, reject) => {
      zip.on("error", () =>
        reject(problem("That archive contains invalid or unsafe entries.")),
      );
      zip.on("end", () => resolve({ entries: count, expandedBytes: total }));
      zip.on("entry", (entry) => {
        count++;
        total += entry.uncompressedSize;
        if (
          count > maxEntries ||
          entry.uncompressedSize > maxEntry ||
          total > maxTotal
        ) {
          reject(
            problem("The archive expands beyond the supported document size."),
          );
          zip.close();
          return;
        }
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) {
          reject(problem("Linked archive entries are unsupported."));
          zip.close();
          return;
        }
        zip.readEntry();
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}
