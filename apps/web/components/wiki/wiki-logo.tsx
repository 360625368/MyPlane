/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { ReactionOutline } from "@makeplane/propel/icons";
import { EmojiPicker, Logo } from "@plane/blocks/emoji-icon-picker";
import type { ChangeHandlerPayload } from "@plane/blocks/emoji-icon-picker";
import { useTranslation } from "@plane/i18n";
import type { TLogoProps } from "@plane/types";

export function wikiLogo(logo: Record<string, unknown> | TLogoProps | undefined): TLogoProps | undefined {
  if (!logo || typeof logo !== "object" || !("in_use" in logo)) return undefined;
  if (logo.in_use !== "emoji" && logo.in_use !== "icon") return undefined;
  return logo as TLogoProps;
}

export function logoFromChange(value: ChangeHandlerPayload): TLogoProps {
  if (value.type === "emoji") return { in_use: "emoji", emoji: { value: value.value } };
  return { in_use: "icon", icon: value.value };
}

type Props = {
  logo: Record<string, unknown> | TLogoProps | undefined;
  editable: boolean;
  onChange: (logo: TLogoProps) => void;
};

export function WikiLogoControl({ logo, editable, onChange }: Props) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const selected = wikiLogo(logo);

  return (
    <EmojiPicker
      isOpen={isOpen}
      handleToggle={setIsOpen}
      disabled={!editable}
      className="flex items-center justify-center"
      buttonClassName="flex items-center justify-center"
      label={
        selected ? (
          <Logo logo={selected} size={20} type="lucide" />
        ) : (
          <span className="flex items-center gap-1 text-caption-sm-medium text-tertiary">
            <ReactionOutline className="size-4" />
            {t("workspace_wiki.icon")}
          </span>
        )
      }
      onChange={(value) => onChange(logoFromChange(value))}
      defaultIconColor={selected?.in_use === "icon" ? selected.icon?.color : undefined}
      defaultOpen={selected?.in_use === "emoji" ? "emoji" : "icon"}
    />
  );
}
