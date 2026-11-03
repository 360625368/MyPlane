# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Forward /uploads to MinIO.

Presigned URLs are signed for the API host (request.get_host()/uploads). Docker
installs put a reverse proxy in front of that path. A source install has no
proxy, so the browser POST lands on Django and 404s.
"""

import http.client
import os
from urllib.parse import urlparse

from django.http import HttpResponse


class MinioUploadProxyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        upstream = os.environ.get("AWS_S3_ENDPOINT_URL") or os.environ.get("MINIO_ENDPOINT_URL") or "http://127.0.0.1:9000"
        self.upstream = urlparse(upstream)

    def __call__(self, request):
        if os.environ.get("USE_MINIO") == "1" and (request.path == "/uploads" or request.path.startswith("/uploads/")):
            return self._proxy(request)
        return self.get_response(request)

    def _proxy(self, request):
        headers = {"Host": request.get_host()}
        for name, value in request.headers.items():
            lowered = name.lower()
            if lowered in {"content-type", "content-length", "authorization"} or lowered.startswith("x-amz-"):
                headers[name] = value

        body = request.body if request.method in {"POST", "PUT", "PATCH"} else None
        port = self.upstream.port or (443 if self.upstream.scheme == "https" else 80)
        connection_cls = http.client.HTTPSConnection if self.upstream.scheme == "https" else http.client.HTTPConnection
        connection = connection_cls(self.upstream.hostname, port, timeout=60)
        try:
            connection.request(request.method, request.get_full_path(), body=body, headers=headers)
            upstream = connection.getresponse()
            response = HttpResponse(upstream.read(), status=upstream.status)
            content_type = upstream.getheader("Content-Type")
            if content_type:
                response["Content-Type"] = content_type
            etag = upstream.getheader("ETag")
            if etag:
                response["ETag"] = etag
            return response
        finally:
            connection.close()
