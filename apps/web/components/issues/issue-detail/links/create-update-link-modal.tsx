/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "@plane/i18n";
// plane types
import { Button } from "@makeplane/propel/components/button";
import type { TIssueLinkEditableFields, TIssueServiceType } from "@plane/types";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { MoreHorizontalOutline } from "@makeplane/propel/icons";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "@makeplane/propel/components/menu";
import { InputField } from "@makeplane/propel/components/input-field";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// types
import { DocumentLinkPicker } from "./document-picker";
import type { TLinkOperations } from "./root";

export type TLinkOperationsModal = Exclude<TLinkOperations, "remove">;

export type TIssueLinkCreateFormFieldOptions = TIssueLinkEditableFields & {
  id?: string;
};

export type TIssueLinkCreateEditModal = {
  isModalOpen: boolean;
  handleOnClose?: () => void;
  linkOperations: TLinkOperationsModal;
  issueServiceType: TIssueServiceType;
};

const defaultValues: TIssueLinkCreateFormFieldOptions = {
  title: "",
  url: "",
};

export const IssueLinkCreateUpdateModal = observer(function IssueLinkCreateUpdateModal(
  props: TIssueLinkCreateEditModal
) {
  const { isModalOpen, handleOnClose, linkOperations, issueServiceType } = props;
  // i18n
  const { t } = useTranslation();
  const [source, setSource] = useState<"wiki" | "page" | null>(null);
  // react hook form
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    control,
    reset,
    setValue,
  } = useForm<TIssueLinkCreateFormFieldOptions>({
    defaultValues,
  });
  // store hooks
  const { issueLinkData: preloadedData, setIssueLinkData } = useIssueDetail(issueServiceType);

  const onClose = () => {
    setIssueLinkData(null);
    if (handleOnClose) handleOnClose();
  };

  const handleFormSubmit = async (formData: TIssueLinkCreateFormFieldOptions) => {
    const parsedUrl = formData.url.startsWith("http") ? formData.url : `http://${formData.url}`;
    try {
      if (!formData || !formData.id) await linkOperations.create({ title: formData.title, url: parsedUrl });
      else await linkOperations.update(formData.id, { title: formData.title, url: parsedUrl });
      onClose();
    } catch (error) {
      console.error("error", error);
    }
  };

  useEffect(() => {
    if (isModalOpen) {
      reset({ ...defaultValues, ...preloadedData });
      setSource(null);
    }
  }, [preloadedData, reset, isModalOpen]);

  return (
    <Dialog
      open={isModalOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="md">
        <form onSubmit={handleSubmit(handleFormSubmit)} className="flex min-h-0 flex-1 flex-col">
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{preloadedData?.id ? t("common.update_link") : t("common.add_link")}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody render={<div className="space-y-3" />}>
              <Controller
                control={control}
                name="url"
                rules={{
                  required: "URL is required",
                }}
                render={({ field: { value, onChange, ref } }) => (
                  <InputField
                    size="lg"
                    orientation="vertical"
                    id="url"
                    type="text"
                    label={t("common.url")}
                    endIcon={
                      <Menu>
                        <MenuTrigger
                          render={
                            <IconButton
                              type="button"
                              variant="ghost"
                              size="xs"
                              aria-label={t("aria_labels.common.more_actions")}
                              icon={<Icon icon={MoreHorizontalOutline} />}
                            />
                          }
                        />
                        <MenuContent align="end">
                          <MenuItem label={t("sidebar.wiki")} onClick={() => setSource("wiki")} />
                          <MenuItem label={t("home.recents.filters.pages")} onClick={() => setSource("page")} />
                        </MenuContent>
                      </Menu>
                    }
                    value={value}
                    onChange={onChange}
                    ref={ref}
                    error={errors.url ? t("common.url_is_invalid") : undefined}
                    placeholder={t("common.type_or_paste_a_url")}
                  />
                )}
              />
              <Controller
                control={control}
                name="title"
                render={({ field: { value, onChange, ref } }) => (
                  <InputField
                    size="lg"
                    orientation="vertical"
                    id="title"
                    type="text"
                    label={t("common.display_title")}
                    hint={t("common.optional")}
                    value={value}
                    onChange={onChange}
                    ref={ref}
                    error={errors.title?.message}
                    placeholder={t("common.link_title_placeholder")}
                  />
                )}
              />
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button variant="secondary" size="md" stretch="auto" onClick={onClose} label={t("common.cancel")} />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              type="submit"
              loading={isSubmitting}
              label={`${
                preloadedData?.id
                  ? isSubmitting
                    ? t("common.updating")
                    : t("common.update")
                  : isSubmitting
                    ? t("common.adding")
                    : t("common.add")
              } ${t("common.link")}`}
            />
          </DialogActions>
        </form>
      </DialogContent>
      <Dialog
        open={isModalOpen && source !== null}
        onOpenChange={(open) => {
          if (!open) setSource(null);
        }}
      >
        <DialogContent size="md">
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{source === "wiki" ? t("sidebar.wiki") : t("home.recents.filters.pages")}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody>
              {source && (
                <DocumentLinkPicker
                  key={source}
                  kind={source}
                  onSelect={(title, url) => {
                    setValue("title", title, { shouldDirty: true });
                    setValue("url", url, { shouldDirty: true, shouldValidate: true });
                    setSource(null);
                  }}
                />
              )}
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button
              type="button"
              variant="secondary"
              size="md"
              stretch="auto"
              label={t("common.cancel")}
              onClick={() => setSource(null)}
            />
          </DialogActions>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
});
