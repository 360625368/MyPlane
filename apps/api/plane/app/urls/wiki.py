# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.wiki.base import (
    WikiNodeAccessEndpoint,
    WikiNodeEndpoint,
    WikiNodeRestoreEndpoint,
    WikiTrashEndpoint,
)

urlpatterns = [
    path("workspaces/<str:slug>/wiki/nodes/", WikiNodeEndpoint.as_view(), name="wiki-nodes"),
    path("workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/", WikiNodeEndpoint.as_view(), name="wiki-node"),
    path(
        "workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/restore/",
        WikiNodeRestoreEndpoint.as_view(),
        name="wiki-node-restore",
    ),
    path("workspaces/<str:slug>/wiki/trash/", WikiTrashEndpoint.as_view(), name="wiki-trash"),
    path(
        "workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/access/",
        WikiNodeAccessEndpoint.as_view(),
        name="wiki-node-access",
    ),
]
