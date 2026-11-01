from django.db import migrations

GRADES = [
    ("Or 18K", "gold", 750, "#c9a227", 1),
    ("Or 21K", "gold", 875, "#d4a017", 2),
    ("Or 24K", "gold", 999, "#e6b422", 3),
    ("Argent 925", "silver", 925, "#9aa3ad", 4),
]


def create_defaults(apps, schema_editor):
    ShopSettings = apps.get_model("main", "ShopSettings")
    MetalGrade = apps.get_model("main", "MetalGrade")
    ShopSettings.objects.get_or_create(pk=1)
    if not MetalGrade.objects.exists():
        for name, metal, purity, color, order in GRADES:
            MetalGrade.objects.create(name=name, metal=metal, purity=purity, color=color, sortOrder=order)


class Migration(migrations.Migration):
    dependencies = [("main", "0001_initial")]
    operations = [migrations.RunPython(create_defaults, migrations.RunPython.noop)]
