import { expect, it, vi } from "vitest";
import { EFileAssetType } from "@plane/types";
import { uploadWikiImage } from "./wiki-assets";

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/services/file.service", () => ({
  FileService: class {
    uploadWorkspaceAsset = upload;
  },
}));

it("uploads the image against its Wiki file and returns the editor asset ID", async () => {
  const image = new File(["image"], "test.png", { type: "image/png" });
  upload.mockResolvedValue({ asset_id: "uploaded-image" });
  expect(await uploadWikiImage("team", "wiki-file", image)).toBe("uploaded-image");
  expect(upload).toHaveBeenCalledWith(
    "team",
    { entity_type: EFileAssetType.WIKI_DESCRIPTION, entity_identifier: "wiki-file" },
    image
  );
});
