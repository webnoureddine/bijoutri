"""Login security: lockout after repeated failures, optional two-step code (TOTP), login history,
and a per-user token version so the owner can sign someone out everywhere (also on password change / deactivate)."""
from datetime import timedelta

import pyotp
from django.conf import settings
from django.contrib.auth import authenticate
from django.utils import timezone
from rest_framework import permissions
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import RefreshToken

from .models import LoginEvent, User

MAX_FAILS = getattr(settings, "LOGIN_MAX_FAILS", 5)
LOCK_MINUTES = getattr(settings, "LOGIN_LOCK_MINUTES", 15)


def client_ip(request):
    fwd = request.META.get("HTTP_X_FORWARDED_FOR")
    return (fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR", ""))[:64]


def record(request, user, username, success, reason=""):
    LoginEvent.objects.create(
        user=user, username=username[:150], ip=client_ip(request),
        userAgent=request.META.get("HTTP_USER_AGENT", "")[:300], success=success, reason=reason,
    )


def find_user(identifier):
    identifier = (identifier or "").strip()
    if "@" in identifier:
        return User.objects.filter(email__iexact=identifier).first()
    return User.objects.filter(username__iexact=identifier).first()


def tokens_for(user, remember=False):
    refresh = RefreshToken.for_user(user)
    refresh["tv"] = user.tokenVersion
    if remember:
        refresh.set_exp(lifetime=timedelta(days=settings.REMEMBER_ME_DAYS))
    access = refresh.access_token
    access["tv"] = user.tokenVersion
    return {"access": str(access), "refresh": str(refresh)}


class LoginError(Exception):
    def __init__(self, code, message, status=401):
        self.code, self.message, self.status = code, message, status


def login(request, identifier, password, otp=None, remember=False):
    """Returns tokens, or {'otpRequired': True}. Raises LoginError."""
    user = find_user(identifier)
    now = timezone.now()
    if user and user.lockedUntil and user.lockedUntil > now:
        minutes = max(1, int((user.lockedUntil - now).total_seconds() // 60) + 1)
        record(request, user, identifier, False, "locked")
        raise LoginError("locked", f"Too many wrong passwords. Try again in {minutes} minutes.", 429)

    authed = authenticate(request, username=user.username if user else identifier, password=password) if password else None
    if authed is None:
        if user:
            user.failedLogins += 1
            if user.failedLogins >= MAX_FAILS:
                user.lockedUntil = now + timedelta(minutes=LOCK_MINUTES)
                user.failedLogins = 0
            user.save(update_fields=["failedLogins", "lockedUntil"])
        record(request, user, identifier, False, "inactive" if user and not user.is_active else "bad_password")
        raise LoginError("bad_credentials", "The email or password is wrong.")

    if authed.totpEnabled:
        if not otp:
            return {"otpRequired": True}
        if not pyotp.TOTP(authed.totpSecret).verify(str(otp).replace(" ", ""), valid_window=1):
            record(request, authed, identifier, False, "bad_code")
            raise LoginError("bad_code", "The 6-digit code is wrong.")

    authed.failedLogins = 0
    authed.lockedUntil = None
    authed.last_login = now
    authed.save(update_fields=["failedLogins", "lockedUntil", "last_login"])
    record(request, authed, identifier, True)
    return tokens_for(authed, remember)


def sign_out_everywhere(user):
    user.tokenVersion += 1
    user.save(update_fields=["tokenVersion"])


class VersionedJWTAuthentication(JWTAuthentication):
    """Rejects tokens issued before the user's last 'sign out everywhere', password change or deactivation."""

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if validated_token.get("tv", 0) != user.tokenVersion:
            raise AuthenticationFailed("Session ended. Please sign in again.", code="token_revoked")
        return user


# --------------------------------------------------------------------------- permissions
class IsOwner(permissions.BasePermission):
    message = "Only the owner can do this."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_owner)


class OwnerForWrites(permissions.BasePermission):
    """Everyone signed in may read; only the owner may change."""

    message = "Only the owner can change this."

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        return request.method in permissions.SAFE_METHODS or request.user.is_owner
