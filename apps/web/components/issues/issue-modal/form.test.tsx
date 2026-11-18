// Reproduce the list quick-action wrapper, including its click-cancelling behavior.
/* oxlint-disable jsx_a11y/click-events-have-key-events, jsx_a11y/no-static-element-interactions */
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Control } from "react-hook-form";
import type { TIssue } from "@plane/types";
import { Controller } from "react-hook-form";
import { Dialog, DialogContent } from "@makeplane/propel/components/dialog";
import { IssueFormRoot } from "./form";
import { IssueTitleInput } from "./components/title-input";

vi.mock("next/navigation", () => ({ useParams: () => ({ workspaceSlug: "test", projectId: "project" }) }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@plane/blocks/toast", () => ({ setToast: vi.fn() }));
vi.mock("@/hooks/use-platform-os", () => ({ usePlatformOS: () => ({ isMobile: false }) }));
vi.mock("@/hooks/store/use-project", () => ({ useProject: () => ({ getProjectById: vi.fn() }) }));
vi.mock("@/hooks/store/use-project-state", () => ({ useProjectState: () => ({ getStateById: vi.fn() }) }));
vi.mock("@/hooks/store/use-issue-detail", () => ({ useIssueDetail: () => ({ issue: { getIssueById: vi.fn() } }) }));
vi.mock("@/hooks/store/workspace-draft", () => ({ useWorkspaceDraftIssues: () => ({ moveIssue: vi.fn() }) }));
vi.mock("@/hooks/use-project-issue-properties", () => ({
  useProjectIssueProperties: () => ({ fetchCycles: vi.fn() }),
}));
vi.mock("@/hooks/context/use-issue-modal", () => ({
  useIssueModal: () => ({
    workItemTemplateId: null,
    isApplyingTemplate: false,
    selectedParentIssue: null,
    setWorkItemTemplateId: vi.fn(),
    setSelectedParentIssue: vi.fn(),
    getIssueTypeIdOnProjectChange: () => null,
    handlePropertyValuesValidation: () => true,
    handleCreateUpdatePropertyValues: vi.fn(),
    handleTemplateChange: vi.fn(),
  }),
}));
vi.mock("@/components/issues/issue-modal/components", () => ({
  IssueTitleInput: (props: React.ComponentProps<typeof IssueTitleInput>) => <IssueTitleInput {...props} />,
  IssueProjectSelect: ({ control }: { control: Control<TIssue> }) => (
    <Controller control={control} name="project_id" rules={{ required: true }} render={() => <span>Project</span>} />
  ),
  IssueDescriptionEditor: ({ editorRef }: { editorRef: React.RefObject<unknown> }) => {
    React.useImperativeHandle(editorRef, () => ({ isEditorReadyToDiscard: () => true, clearEditor: vi.fn() }));
    return <div>Description</div>;
  },
  IssueDefaultProperties: () => null,
  IssueParentTag: () => null,
}));

describe("work item form submission", () => {
  it.each(["Updated title", "Original"])("submits %s from a row that cancels clicks", async (title) => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <div
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <Dialog open>
          <DialogContent>
            <IssueFormRoot
              data={{ id: "issue", name: "Original", project_id: "project", description_html: "<p></p>" }}
              projectId="project"
              issueTitleRef={{ current: null }}
              isCreateMoreToggleEnabled={false}
              onCreateMoreToggleChange={vi.fn()}
              onAssetUpload={vi.fn()}
              onClose={vi.fn()}
              onSubmit={onSubmit}
              isDraft={false}
              isDuplicateModalOpen={false}
              handleDuplicateIssueModal={vi.fn()}
            />
          </DialogContent>
        </Dialog>
      </div>
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: title } });
    await userEvent.click(screen.getByRole("button", { name: /^update$/ }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "issue",
          project_id: "project",
          description_html: "<p></p>",
          ...(title !== "Original" ? { name: title } : {}),
        }),
        false
      )
    );
  });
});
