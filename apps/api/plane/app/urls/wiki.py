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
from plane.app.views.wiki.document import (
    WikiNodeDescriptionEndpoint,
    WikiNodeDuplicateEndpoint,
    WikiNodeStateEndpoint,
    WikiNodeVersionEndpoint,
    WikiRecentEndpoint,
    WikiSearchEndpoint,
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
    path("workspaces/<str:slug>/wiki/search/", WikiSearchEndpoint.as_view(), name="wiki-search"),
    path("workspaces/<str:slug>/wiki/recent/", WikiRecentEndpoint.as_view(), name="wiki-recent"),
    path(
        "workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/description/",
        WikiNodeDescriptionEndpoint.as_view(),
        name="wiki-node-description",
    ),
    path(
        "workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/versions/",
        WikiNodeVersionEndpoint.as_view(),
        name="wiki-node-versions",
    ),
    path(
        "workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/state/",
        WikiNodeStateEndpoint.as_view(),
        name="wiki-node-state",
    ),
    path(
        "workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/duplicate/",
        WikiNodeDuplicateEndpoint.as_view(),
        name="wiki-node-duplicate",
    ),
    path(
        "workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/access/",
        WikiNodeAccessEndpoint.as_view(),
        name="wiki-node-access",
    ),
]
