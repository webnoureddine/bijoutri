"""Settings come from environment variables (or backend/.env). Three ways to run, same code:

* Local / shop network (LAN): nothing to set. SQLite file, photos in backend/media, and Django also serves the
  built website, so every PC and phone on the shop Wi-Fi opens http://<this-PC-IP>:8000.
* Online with Supabase: set DATABASE_URL (Supabase Postgres) and the SUPABASE_S3_* variables (photo storage).
* Anything else Postgres: just DATABASE_URL.
"""
import os
from datetime import timedelta
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env(name, default=""):
    return os.environ.get(name, default)


def env_bool(name, default=False):
    return env(name, "1" if default else "0").lower() in ("1", "true", "yes", "on")


def env_list(name, default=""):
    return [x.strip() for x in env(name, default).split(",") if x.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = env("DJANGO_SECRET_KEY") or ("dev-only-insecure-key-change-me-" + "x" * 20)
if not DEBUG and SECRET_KEY.startswith("dev-only") and env_bool("REQUIRE_SECRET_KEY", False):
    raise RuntimeError("Set DJANGO_SECRET_KEY")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "*")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "django_rest_passwordreset",
    "main",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]

# --------------------------------------------------------------------------- database
if env("DATABASE_URL"):
    DATABASES = {"default": dj_database_url.parse(env("DATABASE_URL"), conn_max_age=60, ssl_require=env_bool("DB_SSL", True))}
    if env_bool("DB_POOLED", False):  # Supabase "transaction" pooler
        DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True
        DATABASES["default"]["CONN_MAX_AGE"] = 0
else:
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3",
                             "OPTIONS": {"timeout": 20}}}
SUPABASE_LOCKDOWN = env_bool("SUPABASE_LOCKDOWN", True)

AUTH_USER_MODEL = "main.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en"  # API messages stay English; the app translates them
TIME_ZONE = env("TIME_ZONE", "Africa/Algiers")
USE_I18N = True
USE_TZ = True

# --------------------------------------------------------------------------- files
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
DATA_UPLOAD_MAX_MEMORY_SIZE = 12 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 12 * 1024 * 1024

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}
if env("SUPABASE_S3_BUCKET"):
    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": env("SUPABASE_S3_BUCKET"),
            "endpoint_url": env("SUPABASE_S3_ENDPOINT"),
            "access_key": env("SUPABASE_S3_ACCESS_KEY"),
            "secret_key": env("SUPABASE_S3_SECRET_KEY"),
            "region_name": env("SUPABASE_S3_REGION", "eu-central-1"),
            "custom_domain": env("SUPABASE_PUBLIC_URL_HOST") or None,
            "querystring_auth": False,
            "file_overwrite": False,
            "default_acl": None,
            "signature_version": "s3v4",
            "addressing_style": "path",
        },
    }

# The built website (frontend/dist). When it exists, Django serves it at "/" (LAN mode: one program, one address).
FRONTEND_DIST = Path(env("FRONTEND_DIST", str(BASE_DIR.parent / "frontend" / "dist")))
WHITENOISE_ROOT = FRONTEND_DIST if FRONTEND_DIST.exists() else None
SERVE_MEDIA = env_bool("SERVE_MEDIA", not env("SUPABASE_S3_BUCKET"))

# --------------------------------------------------------------------------- API & security
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["main.security.VersionedJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_RATES": {"login": env("LOGIN_RATE", "10/min")},
}
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(env("ACCESS_MINUTES", "15"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(hours=int(env("REFRESH_HOURS", "12"))),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": False,
    "SIGNING_KEY": SECRET_KEY,
}
REMEMBER_ME_DAYS = int(env("REMEMBER_ME_DAYS", "30"))
LOGIN_MAX_FAILS = int(env("LOGIN_MAX_FAILS", "5"))
LOGIN_LOCK_MINUTES = int(env("LOGIN_LOCK_MINUTES", "15"))
DJANGO_REST_MULTITOKENAUTH_RESET_TOKEN_EXPIRY_TIME = 2  # hours
DJANGO_REST_PASSWORDRESET_NO_INFORMATION_LEAKAGE = True

CORS_ALLOWED_ORIGINS = env_list("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
CORS_ALLOW_ALL_ORIGINS = env_bool("CORS_ALLOW_ALL", False)
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")

SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "same-origin"
if env_bool("HTTPS", False):  # online behind HTTPS (Render, etc.)
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env_bool("SSL_REDIRECT", True)
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
    SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = True

# --------------------------------------------------------------------------- email
FRONTEND_URL = env("FRONTEND_URL", "http://localhost:5173").rstrip("/")
if env("EMAIL_HOST"):
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST = env("EMAIL_HOST")
    EMAIL_PORT = int(env("EMAIL_PORT", "587"))
    EMAIL_HOST_USER = env("EMAIL_HOST_USER")
    EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD")
    EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
    DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", EMAIL_HOST_USER)
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

LOGGING = {"version": 1, "disable_existing_loggers": False,
           "handlers": {"console": {"class": "logging.StreamHandler"}},
           "root": {"handlers": ["console"], "level": "WARNING"}}
