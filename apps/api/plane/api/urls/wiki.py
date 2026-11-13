# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views.wiki import (
    WikiNodeTokenEndpoint,
    WikiSearchReadEndpoint,
    WikiTrashTokenEndpoint,
    WikiRestoreTokenEndpoint,
    WikiDescriptionTokenEndpoint,
    WikiDuplicateTokenEndpoint,
    WikiStateTokenEndpoint,
    WikiVersionTokenEndpoint,
    WikiAccessTokenEndpoint,
    WikiChangeTokenEndpoint,
    WikiChangeDetailTokenEndpoint,
)


urlpatterns = [
    path(
        "workspaces/<str:slug>/wiki/nodes/",
        WikiNodeTokenEndpoint.as_view(http_method_names=["get", "post", "head", "options"]),
        name="api-wiki-nodes",
    ),
    path(
        "workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/",
        WikiNodeTokenEndpoint.as_view(http_method_names=["get", "patch", "delete", "head", "options"]),
        name="api-wiki-node",
    ),
    path("workspaces/<str:slug>/wiki/search/", WikiSearchReadEndpoint.as_view(), name="api-wiki-search"),
    path("workspaces/<str:slug>/wiki/trash/", WikiTrashTokenEndpoint.as_view()),
    path("workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/restore/", WikiRestoreTokenEndpoint.as_view()),
    path("workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/description/", WikiDescriptionTokenEndpoint.as_view()),
    path("workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/duplicate/", WikiDuplicateTokenEndpoint.as_view()),
    path("workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/state/", WikiStateTokenEndpoint.as_view()),
    path("workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/versions/", WikiVersionTokenEndpoint.as_view()),
    path("workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/access/", WikiAccessTokenEndpoint.as_view()),
    path("workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/changes/", WikiChangeTokenEndpoint.as_view()),
    path(
        "workspaces/<str:slug>/wiki/nodes/<uuid:node_id>/changes/<uuid:change_id>/",
        WikiChangeDetailTokenEndpoint.as_view(),
    ),
]
