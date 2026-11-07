import io
import json
import unittest
import urllib.error
from unittest.mock import Mock, patch

from tlx_server.gateway import Gateway
from tlx_server.site import ApiError


class Reply(io.BytesIO):
    def __init__(self, status: int, data: dict[str, object]) -> None:
        super().__init__(json.dumps(data).encode())
        self.status = status


class GatewayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.session = Mock()
        self.session.token.return_value = "fixture-token"
        self.gateway = Gateway(Mock(), self.session)

    def test_expired_login_falls_back_to_public_get_without_forwarding_old_token(self) -> None:
        self.session.rejected.return_value = None
        with patch("tlx_server.gateway._opener.open", side_effect=[Reply(401, {"error": "expired"}), Reply(200, {"ok": True})]) as send:
            self.assertEqual(self.gateway.request("/v1/example/"), {"ok": True})
        self.assertEqual(send.call_count, 2)
        self.assertEqual(send.call_args_list[0].args[0].get_header("Authorization"), "Bearer fixture-token")
        self.assertIsNone(send.call_args_list[1].args[0].get_header("Authorization"))

    def test_mutations_retry_only_an_explicit_401_with_a_refreshed_token(self) -> None:
        self.session.rejected.return_value = "refreshed-fixture"
        with patch("tlx_server.gateway._opener.open", side_effect=[Reply(401, {"error": "expired"}), Reply(200, {"ok": True})]) as send:
            self.gateway.request("/v1/example/", "POST", {"amount": 10})
        self.assertEqual(send.call_count, 2)
        self.assertEqual(send.call_args_list[1].args[0].get_header("Authorization"), "Bearer refreshed-fixture")
        self.session.rejected.return_value = None
        with patch("tlx_server.gateway._opener.open", return_value=Reply(401, {"error": "expired"})) as send, self.assertRaises(ApiError):
            self.gateway.request("/v1/example/", "POST", {"amount": 10})
        self.assertEqual(send.call_count, 1)

    def test_network_failure_does_not_retry_a_potentially_accepted_bid(self) -> None:
        with (
            patch("tlx_server.gateway._opener.open", side_effect=urllib.error.URLError("disconnected")) as send,
            self.assertRaisesRegex(ApiError, "may have been accepted"),
        ):
            self.gateway.request("/v1/auctions/lots/1/bids", "POST", {"amount": 10})
        self.assertEqual(send.call_count, 1)


if __name__ == "__main__":
    unittest.main()
