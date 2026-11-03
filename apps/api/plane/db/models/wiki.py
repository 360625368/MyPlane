# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.conf import settings
from django.db import models
from django.utils import timezone

from plane.utils.html_processor import strip_tags

from .base import BaseModel


def get_wiki_view_props():
    return {"full_width": False}


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
    description_json = models.JSONField(default=dict, blank=True)
    description_html = models.TextField(blank=True, default="<p></p>")
    description_stripped = models.TextField(blank=True, null=True)
    color = models.CharField(max_length=255, blank=True)
    logo_props = models.JSONField(default=dict)
    view_props = models.JSONField(default=get_wiki_view_props)
    is_locked = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)

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

    def save(self, *args, **kwargs):
        html = self.description_html
        self.description_stripped = None if (html == "" or html is None) else strip_tags(html)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class WikiNodeVersion(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="wiki_node_versions")
    node = models.ForeignKey(WikiNode, on_delete=models.CASCADE, related_name="versions")
    owned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wiki_node_versions",
    )
    last_saved_at = models.DateTimeField(default=timezone.now)
    description_json = models.JSONField(default=dict, blank=True)
    description_html = models.TextField(blank=True, default="<p></p>")
    description_stripped = models.TextField(blank=True, null=True)

    class Meta:
        verbose_name = "Wiki Node Version"
        verbose_name_plural = "Wiki Node Versions"
        db_table = "wiki_node_versions"
        ordering = ("-last_saved_at",)

    def save(self, *args, **kwargs):
        html = self.description_html
        self.description_stripped = None if (html == "" or html is None) else strip_tags(html)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.node_id} {self.last_saved_at}"


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
