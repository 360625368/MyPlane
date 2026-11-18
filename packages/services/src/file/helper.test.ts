import { describe, expect, it } from "vitest";
import { getFileMetaDataForUpload } from "./helper";

describe("attachment file metadata", () => {
  it.each(["notes.md", "NOTES.MD", "notes.markdown"])(
    "identifies Markdown %s without a binary signature",
    async (name) => {
      const file = new File(["# Notes\n中文内容"], name);
      await expect(getFileMetaDataForUpload(file)).resolves.toEqual({ name, size: file.size, type: "text/markdown" });
    }
  );

  it("identifies plain text without a binary signature", async () => {
    const file = new File(["Notes"], "notes.txt");
    await expect(getFileMetaDataForUpload(file)).resolves.toMatchObject({ type: "text/plain" });
  });

  it("prefers a detected binary signature over the filename", async () => {
    const file = new File(["%PDF-1.7\n"], "notes.md");
    await expect(getFileMetaDataForUpload(file)).resolves.toMatchObject({ type: "application/pdf" });
  });

  it("leaves unknown file types unsupported", async () => {
    const file = new File([new Uint8Array([0, 1, 2, 3])], "unknown.bin");
    await expect(getFileMetaDataForUpload(file)).resolves.toMatchObject({ type: "" });
  });
});
