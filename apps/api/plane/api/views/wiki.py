# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.api.middleware.api_authentication import APIKeyAuthentication
from plane.api.rate_limit import ApiKeyRateThrottle
from plane.app.views.wiki.base import (
    WikiNodeEndpoint,
    WikiNodeRestoreEndpoint,
    WikiTrashEndpoint,
    WikiNodeAccessEndpoint,
)
from plane.app.views.wiki.document import (
    WikiSearchEndpoint,
    WikiNodeDescriptionEndpoint,
    WikiNodeDuplicateEndpoint,
    WikiNodeStateEndpoint,
    WikiNodeVersionEndpoint,
)
from plane.app.views.wiki.changes import WikiChangeRequestEndpoint, WikiChangeRequestDetailEndpoint
from rest_framework.exceptions import ParseError


class WikiTokenMixin:
    """Use Token auth and throttling while retaining all existing Wiki permissions."""

    authentication_classes = [APIKeyAuthentication]
    throttle_classes = [ApiKeyRateThrottle]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method in ("POST", "PUT", "PATCH") and not isinstance(request.data, dict):
            raise ParseError("Request body must be a JSON object.")


class WikiNodeTokenEndpoint(WikiTokenMixin, WikiNodeEndpoint):
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]


class WikiSearchReadEndpoint(WikiTokenMixin, WikiSearchEndpoint):
    http_method_names = ["get", "head", "options"]


class WikiTrashTokenEndpoint(WikiTokenMixin, WikiTrashEndpoint):
    http_method_names = ["get", "head", "options"]


class WikiRestoreTokenEndpoint(WikiTokenMixin, WikiNodeRestoreEndpoint):
    http_method_names = ["post", "options"]


class WikiDescriptionTokenEndpoint(WikiTokenMixin, WikiNodeDescriptionEndpoint):
    http_method_names = ["patch", "options"]


class WikiDuplicateTokenEndpoint(WikiTokenMixin, WikiNodeDuplicateEndpoint):
    http_method_names = ["post", "options"]


class WikiStateTokenEndpoint(WikiTokenMixin, WikiNodeStateEndpoint):
    http_method_names = ["post", "options"]


class WikiVersionTokenEndpoint(WikiTokenMixin, WikiNodeVersionEndpoint):
    http_method_names = ["get", "post", "head", "options"]


class WikiAccessTokenEndpoint(WikiTokenMixin, WikiNodeAccessEndpoint):
    http_method_names = ["get", "put", "head", "options"]


class WikiChangeTokenEndpoint(WikiTokenMixin, WikiChangeRequestEndpoint):
    http_method_names = ["get", "post", "head", "options"]


class WikiChangeDetailTokenEndpoint(WikiTokenMixin, WikiChangeRequestDetailEndpoint):
    http_method_names = ["patch", "post", "options"]
