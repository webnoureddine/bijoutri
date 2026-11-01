from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, Http404
from django.urls import include, path, re_path
from django.views.static import serve


def spa(request, *args, **kwargs):
    """Every page of the website gets index.html (the React app picks the screen)."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        raise Http404("Build the website first: cd frontend && npm run build")
    return FileResponse(open(index, "rb"), content_type="text/html")


urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/", include("main.urls")),
]
if settings.SERVE_MEDIA:
    urlpatterns += [re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT})]
urlpatterns += [re_path(r"^(?!api/|media/|static/|django-admin/).*$", spa)]
