# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Presigned GET /uploads requests must reach MinIO without an empty Content-Length."""

from unittest.mock import Mock, patch

import pytest
from django.http import HttpResponse
from django.test import RequestFactory

from plane.middleware.minio_proxy import MinioUploadProxyMiddleware


@pytest.fixture
def request_factory():
    return RequestFactory()


@pytest.fixture
def middleware(monkeypatch):
    monkeypatch.setenv("USE_MINIO", "1")
    monkeypatch.setenv("AWS_S3_ENDPOINT_URL", "http://127.0.0.1:9000")
    return MinioUploadProxyMiddleware(Mock(return_value=HttpResponse(b"unreachable")))


def _upstream(status=200, body=b"image-bytes", content_type="image/jpeg"):
    response = Mock()
    response.status = status
    response.read.return_value = body
    response.getheader.side_effect = lambda name: content_type if name == "Content-Type" else None
    connection = Mock()
    connection.getresponse.return_value = response
    return connection


@pytest.mark.unit
class TestMinioUploadProxyMiddleware:
    def test_get_drops_empty_content_length(self, request_factory, middleware):
        request = request_factory.get(
            "/uploads/workspace/cover.jpg?X-Amz-Signature=abc",
            HTTP_HOST="127.0.0.1:8000",
            CONTENT_LENGTH="",
            CONTENT_TYPE="text/plain",
        )
        connection = _upstream()

        with patch("plane.middleware.minio_proxy.http.client.HTTPConnection", return_value=connection):
            response = middleware(request)

        headers = connection.request.call_args.kwargs["headers"]
        assert "Content-Length" not in headers
        assert response.status_code == 200
        assert response.content == b"image-bytes"

    def test_post_keeps_upload_headers(self, request_factory, middleware):
        request = request_factory.post(
            "/uploads/workspace/cover.jpg",
            data=b"file-bytes",
            content_type="image/jpeg",
            HTTP_HOST="127.0.0.1:8000",
            CONTENT_LENGTH="10",
        )
        connection = _upstream(status=204, body=b"", content_type=None)

        with patch("plane.middleware.minio_proxy.http.client.HTTPConnection", return_value=connection):
            middleware(request)

        headers = connection.request.call_args.kwargs["headers"]
        assert headers["Content-Type"] == "image/jpeg"
        assert headers["Content-Length"] == "10"
