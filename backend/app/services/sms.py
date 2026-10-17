"""
SMS provider interface and implementations.

Interface: SmsProvider (abstract)
Implementations:
  - MockSmsProvider — development only; accepts any 6-digit code except 000000.

The app MUST refuse to start in ENVIRONMENT=production with MockSmsProvider.
"""
from __future__ import annotations

import abc
import logging

logger = logging.getLogger(__name__)


class SmsProvider(abc.ABC):
    """Abstract SMS provider — swap implementations without touching business logic."""

    @abc.abstractmethod
    async def send_otp(self, phone: str, code: str) -> bool:
        """
        Send OTP code to E.164 phone number.
        Returns True on success, raises on fatal error.
        phone is the normalised 10-digit string stored in the DB.
        """


class MockSmsProvider(SmsProvider):
    """
    Development-only mock SMS provider.

    Behaviour:
    - Code 000000 always fails (returns False) so tests can exercise the failure path.
    - Any other valid 6-digit code is accepted (returns True) and logged at DEBUG level.
    - NEVER use in production — the startup guard in main.py raises RuntimeError.
    """

    async def send_otp(self, phone: str, code: str) -> bool:
        if code == "000000":
            logger.debug("MockSmsProvider: code 000000 is always-fail sentinel — not sending")
            return False
        logger.info("MockSmsProvider: DEV OTP code [%s] generated for +91%s", code, phone)
        return True


def get_sms_provider(environment: str) -> SmsProvider:
    """
    Factory — returns the appropriate SMS provider for the environment.

    In production, raises RuntimeError if only mock is available.
    """
    if environment == "production":
        # In production a real provider must be wired in here.
        # Raising is the safest default so the app never silently uses mock.
        raise RuntimeError(
            "ENVIRONMENT=production requires a real SMS provider to be configured. "
            "MockSmsProvider is not allowed in production."
        )
    return MockSmsProvider()
