from django.apps import AppConfig
from django.db.models.signals import post_migrate


def lock_down_public_tables(sender, using="default", **kwargs):
    """Supabase exposes every table in the `public` schema through its REST API. Turning on row level
    security (with no policies) makes those tables invisible to that API, while Django, which connects as the
    table owner, keeps full access. Runs after every migrate, so tables added later are covered too."""
    from django.conf import settings
    from django.db import connections

    connection = connections[using]
    if connection.vendor != "postgresql" or not getattr(settings, "SUPABASE_LOCKDOWN", True):
        return
    with connection.cursor() as cursor:
        cursor.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        for (table,) in cursor.fetchall():
            cursor.execute('ALTER TABLE public."%s" ENABLE ROW LEVEL SECURITY' % table.replace('"', '""'))
        cursor.execute("SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")
        if cursor.fetchone():
            cursor.execute("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated")
            cursor.execute("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated")


class MainConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "main"

    def ready(self):
        post_migrate.connect(lock_down_public_tables, sender=self, dispatch_uid="main.lock_down_public_tables")
