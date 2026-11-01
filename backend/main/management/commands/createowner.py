"""python manage.py createowner  — create the shop owner's login (asks for the details)."""
import getpass

from django.core.management.base import BaseCommand

from main.models import User


class Command(BaseCommand):
    help = "Create the owner account"

    def add_arguments(self, parser):
        parser.add_argument("--username")
        parser.add_argument("--email")
        parser.add_argument("--password")
        parser.add_argument("--name", default="")

    def handle(self, *args, **o):
        username = o["username"] or input("Username: ").strip()
        email = o["email"] if o["email"] is not None else input("Email (optional): ").strip()
        password = o["password"] or getpass.getpass("Password (8+ characters): ")
        user = User.objects.create_user(username, email, password, role="owner", full_name=o["name"], is_staff=True, is_superuser=True)
        self.stdout.write(self.style.SUCCESS(f"Owner '{user.username}' created. Sign in with it."))
