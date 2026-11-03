/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { ReactionOutline } from "@makeplane/propel/icons";
import { EmojiPicker, Logo } from "@plane/blocks/emoji-icon-picker";
import type { ChangeHandlerPayload } from "@plane/blocks/emoji-icon-picker";
import { useTranslation } from "@plane/i18n";
import type { TLogoProps } from "@plane/types";
import { cn } from "@plane/utils";

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
  variant?: "inline" | "document";
};

export function WikiLogoControl({ logo, editable, onChange, variant = "inline" }: Props) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const selected = wikiLogo(logo);
  const picker = (label: ReactNode) => (
    <EmojiPicker
      isOpen={isOpen}
      handleToggle={setIsOpen}
      disabled={!editable}
      className="flex items-center justify-center"
      buttonClassName="flex items-center justify-center"
      label={label}
      onChange={(value) => onChange(logoFromChange(value))}
      defaultIconColor={selected?.in_use === "icon" ? selected.icon?.color : undefined}
      defaultOpen={selected?.in_use === "emoji" ? "emoji" : "icon"}
    />
  );

  if (variant === "document") {
    return (
      <>
        <div className={cn("flex items-end text-left", selected ? "h-[71px]" : "h-[64px]")}>
          {!selected && (
            <div className="opacity-0 transition-all duration-200 group-hover/page-header:opacity-100">
              {picker(
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1 rounded-sm p-1 text-body-xs-medium text-tertiary outline-none hover:bg-layer-1",
                    { "bg-layer-1": isOpen }
                  )}
                >
                  <ReactionOutline className="size-4 flex-shrink-0" />
                  {t("workspace_wiki.icon")}
                </button>
              )}
            </div>
          )}
        </div>
        <div
          className={cn("pointer-events-none max-h-0 w-full transition-all duration-300 ease-linear", {
            "pointer-events-auto max-h-14": selected,
          })}
        >
          {selected &&
            picker(
              <div
                className={cn("-ml-2 grid size-14 place-items-center rounded-sm transition-colors", {
                  "hover:bg-layer-1": editable,
                })}
              >
                <Logo logo={selected} size={48} type="lucide" />
              </div>
            )}
        </div>
      </>
    );
  }

  return picker(
    selected ? (
      <Logo logo={selected} size={20} type="lucide" />
    ) : (
      <span className="flex items-center gap-1 text-caption-sm-medium text-tertiary">
        <ReactionOutline className="size-4" />
        {t("workspace_wiki.icon")}
      </span>
    )
  );
}
