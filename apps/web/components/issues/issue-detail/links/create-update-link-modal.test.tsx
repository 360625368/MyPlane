import React from "react";
import { EIssueServiceType } from "@plane/types";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { IssueLinkCreateUpdateModal } from "./create-update-link-modal";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/use-issue-detail", () => ({
  useIssueDetail: () => ({ issueLinkData: null, setIssueLinkData: vi.fn() }),
}));
vi.mock("./document-picker", () => ({
  DocumentLinkPicker: ({ kind, onSelect }: { kind: string; onSelect: (title: string, url: string) => void }) => (
    <button onClick={() => onSelect("Document", "https://plane.test/team/wiki/file")}>Select {kind} document</button>
  ),
}));

it("opens a document picker from URL actions and fills the form without submitting", async () => {
  // jsdom omits the Web Animations API used by the menu scroll area.
  // oxlint-disable-next-line no-extend-native
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
  const create = vi.fn();
  render(
    <IssueLinkCreateUpdateModal
      isModalOpen
      linkOperations={{ create, update: vi.fn(), remove: vi.fn() }}
      issueServiceType={EIssueServiceType.ISSUES}
    />
  );
  const user = userEvent.setup();
  expect(screen.queryByText("Select wiki document")).toBeNull();
  await user.click(screen.getByRole("button", { name: "aria_labels.common.more_actions" }));
  await user.click(await screen.findByRole("menuitem", { name: "sidebar.wiki" }));
  const picker = await screen.findByRole("dialog", { name: "sidebar.wiki" });
  await user.click(within(picker).getByText("Select wiki document"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "sidebar.wiki" })).toBeNull());
  expect((screen.getByLabelText("common.url") as HTMLInputElement).value).toBe("https://plane.test/team/wiki/file");
  expect((screen.getByLabelText(/common.display_title/) as HTMLInputElement).value).toBe("Document");
  expect(create).not.toHaveBeenCalled();
});
