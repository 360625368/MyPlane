/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useNavigate } from "react-router";
import { ClockOutline } from "@makeplane/propel/icons";
import { Avatar } from "@makeplane/propel/components/avatar";
import { Row } from "@plane/blocks/layout";
import { useTranslation } from "@plane/i18n";
import { cn, calculateTimeAgo, renderFormattedDate, renderFormattedTime, getFileURL } from "@plane/utils";
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { useNotification } from "@/hooks/store/notifications/use-notification";
import { NotificationOption } from "./options";

const NOTICE_KEYS: Record<string, string> = {
  submitted: "workspace_wiki.notice_submitted",
  returned: "workspace_wiki.notice_returned",
  merged: "workspace_wiki.notice_merged",
  closed: "workspace_wiki.notice_closed",
  access: "workspace_wiki.notice_access",
  locked: "workspace_wiki.notice_locked",
  archived: "workspace_wiki.notice_archived",
};

type TWikiNotificationItem = {
  workspaceSlug: string;
  notificationId: string;
};

export const WikiNotificationItem = observer(function WikiNotificationItem(props: TWikiNotificationItem) {
  const { workspaceSlug, notificationId } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentSelectedNotificationId } = useWorkspaceNotifications();
  const { asJson: notification, markNotificationAsRead } = useNotification(notificationId);
  const [isSnoozeStateModalOpen, setIsSnoozeStateModalOpen] = useState(false);
  const [customSnoozeModal, setCustomSnoozeModal] = useState(false);

  const wiki = notification?.data?.wiki;
  const name = wiki?.name || notification?.title || "";
  const noticeKey = wiki?.field ? NOTICE_KEYS[wiki.field] : undefined;
  const triggeredBy = notification?.triggered_by_details;
  const isUnread = notification?.read_at === null;

  const openWiki = async () => {
    if (isSnoozeStateModalOpen || customSnoozeModal || !wiki?.node_id) return;
    if (notification?.read_at === null) {
      try {
        await markNotificationAsRead(workspaceSlug);
      } catch (error) {
        console.error(error);
      }
    }
    navigate(`/${workspaceSlug}/wiki/${wiki.node_id}`);
  };

  if (!notification?.id) return <></>;

  return (
    <Row
      className={cn(
        "group relative flex cursor-pointer items-center gap-2 border-b border-subtle py-4 transition-all",
        {
          "bg-layer-1/30": currentSelectedNotificationId === notification.id,
        }
      )}
      onClick={openWiki}
    >
      {isUnread && (
        <div className="absolute top-[50%] left-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />
      )}
      <div className="relative flex w-full gap-2">
        <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-layer-1">
          {triggeredBy && (
            <Avatar
              alt={triggeredBy.display_name || triggeredBy.first_name}
              fallback={(triggeredBy.display_name || triggeredBy.first_name)?.[0]?.toUpperCase()}
              src={getFileURL(triggeredBy.avatar_url)}
              size="xl"
            />
          )}
        </div>
        <div className="w-full space-y-1">
          <div className="relative flex h-8 items-center gap-3">
            <div
              className={cn(
                "-mt-2 line-clamp-1 w-full truncate overflow-hidden break-all whitespace-normal",
                isUnread ? "text-body-xs-semibold text-primary" : "text-body-xs-regular text-secondary"
              )}
            >
              <span className={cn("text-primary", isUnread ? "font-semibold" : "font-medium")}>
                {triggeredBy?.is_bot ? triggeredBy.first_name : triggeredBy?.display_name}{" "}
              </span>
              <span className="text-tertiary">{noticeKey ? t(noticeKey, { name }) : name}</span>
            </div>
            <NotificationOption
              workspaceSlug={workspaceSlug}
              notificationId={notification.id}
              isSnoozeStateModalOpen={isSnoozeStateModalOpen}
              setIsSnoozeStateModalOpen={setIsSnoozeStateModalOpen}
              customSnoozeModal={customSnoozeModal}
              setCustomSnoozeModal={setCustomSnoozeModal}
            />
          </div>
          <div className="relative flex items-center gap-3 text-caption-sm-regular text-secondary">
            <div className="line-clamp-1 w-full truncate overflow-hidden break-words whitespace-normal">{name}</div>
            <div className="flex-shrink-0">
              {notification.snoozed_till ? (
                <p className="flex flex-shrink-0 items-center justify-end gap-x-1 text-tertiary">
                  <ClockOutline className="h-4 w-4" />
                  <span>
                    Till {renderFormattedDate(notification.snoozed_till)},&nbsp;
                    {renderFormattedTime(notification.snoozed_till, "12-hour")}
                  </span>
                </p>
              ) : (
                <p className="mt-auto flex-shrink-0 text-tertiary">
                  {notification.created_at && calculateTimeAgo(notification.created_at)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Row>
  );
});
