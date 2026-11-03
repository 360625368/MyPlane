# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.conf import settings
from django.db import models

from .base import BaseModel


class WikiNode(BaseModel):
    FOLDER = "folder"
    FILE = "file"
    NODE_TYPE_CHOICES = ((FOLDER, "Folder"), (FILE, "File"))
    DEFAULT_SORT_ORDER = 65535

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="wiki_nodes")
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
    )
    name = models.CharField(max_length=255)
    node_type = models.CharField(max_length=16, choices=NODE_TYPE_CHOICES)
    is_root = models.BooleanField(default=False)
    owned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wiki_nodes",
        null=True,
        blank=True,
    )
    sort_order = models.FloatField(default=DEFAULT_SORT_ORDER)

    class Meta:
        verbose_name = "Wiki Node"
        verbose_name_plural = "Wiki Nodes"
        db_table = "wiki_nodes"
        ordering = ("sort_order", "created_at")
        constraints = [
            models.UniqueConstraint(
                fields=["workspace"],
                condition=models.Q(is_root=True, deleted_at__isnull=True),
                name="wiki_one_live_root_per_workspace",
            )
        ]

    def __str__(self):
        return self.name


class WikiNodePermission(BaseModel):
    INVISIBLE = "invisible"
    VISIBLE = "visible"
    EDITABLE = "editable"
    ACCESS_CHOICES = ((INVISIBLE, "Invisible"), (VISIBLE, "Visible"), (EDITABLE, "Editable"))

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="wiki_node_permissions")
    node = models.ForeignKey(WikiNode, on_delete=models.CASCADE, related_name="permissions")
    member = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wiki_node_permissions",
    )
    access = models.CharField(max_length=16, choices=ACCESS_CHOICES)

    class Meta:
        verbose_name = "Wiki Node Permission"
        verbose_name_plural = "Wiki Node Permissions"
        db_table = "wiki_node_permissions"
        constraints = [
            models.UniqueConstraint(
                fields=["node", "member"],
                condition=models.Q(deleted_at__isnull=True),
                name="wiki_node_permission_unique_member_when_not_deleted",
            )
        ]

    def __str__(self):
        return f"{self.node_id} {self.member_id} {self.access}"
