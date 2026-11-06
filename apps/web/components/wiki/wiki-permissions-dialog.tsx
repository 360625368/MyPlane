/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { CloseOutline } from "@makeplane/propel/icons";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogCloseGroup,
  DialogContent,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { Icon } from "@makeplane/propel/components/icon";
import { IconButton } from "@makeplane/propel/components/icon-button";
import { useTranslation } from "@plane/i18n";
import type { TWikiAccess, TWikiMemberAccess } from "@/services/wiki.service";
import { WikiService } from "@/services/wiki.service";

const wikiService = new WikiService();

const ACCESS_OPTIONS: {
  value: "inherit" | TWikiAccess;
  label:
    | "workspace_wiki.access.inherit"
    | "workspace_wiki.access.invisible"
    | "workspace_wiki.access.visible"
    | "workspace_wiki.access.editable";
}[] = [
  { value: "inherit", label: "workspace_wiki.access.inherit" },
  { value: "invisible", label: "workspace_wiki.access.invisible" },
  { value: "visible", label: "workspace_wiki.access.visible" },
  { value: "editable", label: "workspace_wiki.access.editable" },
];

type Props = {
  workspaceSlug: string;
  nodeId: string | null;
  nodeName: string;
  open: boolean;
  onClose: () => void;
};

export function WikiPermissionsDialog(props: Props) {
  const { workspaceSlug, nodeId, nodeName, open, onClose } = props;
  const { t } = useTranslation();
  const [members, setMembers] = useState<TWikiMemberAccess[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open || !nodeId) return;
    let cancelled = false;
    setLoading(true);
    setMessage("");
    void wikiService
      .access(workspaceSlug, nodeId)
      .then((items) => {
        if (!cancelled) setMembers(items);
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setMessage(t("workspace_wiki.forbidden"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `t` is a new function every render; depending on it retriggers this effect forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, open, workspaceSlug]);

  const changeAccess = (memberId: string, value: string) => {
    if (!nodeId) return;
    const access = value === "inherit" ? null : (value as TWikiAccess);
    setMessage("");
    void wikiService
      .updateAccess(workspaceSlug, nodeId, { member_id: memberId, access })
      .then(() => wikiService.access(workspaceSlug, nodeId))
      .then((items) => {
        setMembers(items);
        return undefined;
      })
      .catch(() => setMessage(t("workspace_wiki.forbidden")));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent size="md" aria-label={t("workspace_wiki.permissions")}>
        <DialogCloseGroup>
          <IconButton
            variant="ghost"
            size="xs"
            aria-label={t("close")}
            icon={<Icon icon={CloseOutline} />}
            render={<DialogClose />}
          />
        </DialogCloseGroup>
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>{t("workspace_wiki.permissions")}</DialogTitle>
            </DialogHeading>
          </DialogHeader>
          <DialogBody tabIndex={0}>
            <div className="flex flex-col gap-3">
              {nodeName && <p className="truncate text-body-sm-medium text-primary">{nodeName}</p>}
              {loading && <p className="text-body-sm-regular text-tertiary">{t("workspace_wiki.loading")}</p>}
              {message && <p className="text-body-sm-regular text-danger-primary">{message}</p>}
              {!loading &&
                members.map((member) => (
                  <label key={member.id} className="flex items-center justify-between gap-3">
                    <span className="truncate text-body-sm-regular">{member.display_name || member.email}</span>
                    <select
                      value={member.explicit_access ?? "inherit"}
                      className="h-8 rounded-md border border-subtle bg-layer-1 px-2 text-body-sm-regular"
                      onChange={(event) => changeAccess(member.id, event.target.value)}
                    >
                      {ACCESS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(option.label)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
            </div>
          </DialogBody>
        </DialogMain>
      </DialogContent>
    </Dialog>
  );
}
