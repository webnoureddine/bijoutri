"""Fill an empty database with believable Algerian sample data so you can click around or show the app:
    python manage.py seed_demo
Logins:  owner  demo / demo12345      employee  vendeur / vendeur12345
Do not run it on a real shop database."""
import math
import random
from datetime import timedelta
from io import BytesIO

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.timezone import localdate
from PIL import Image, ImageDraw, ImageFilter

from main import services
from main.models import Bill, CatalogProduct, MetalGrade, Order, Rate, ShopSettings, Staff, StockItem, Supplier, User

GOLD = [(120, 82, 18), (196, 150, 52), (246, 214, 120), (255, 244, 200)]
SILVER = [(90, 96, 104), (160, 168, 178), (220, 226, 232), (250, 252, 255)]


def _metal_stroke(draw, shape, box, width, palette):
    """Draw a shape several times, dark to light and thinner, to fake a polished metal tube."""
    for i, col in enumerate(palette):
        w = max(int(width * (1 - i * 0.24)), 2)
        if shape == "ellipse":
            draw.ellipse(box, outline=col, width=w)
        else:
            draw.line(box, fill=col, width=w, joint="curve")


def piece_photo(kind, metal="gold", seed=0):
    rnd = random.Random(seed)
    pal = GOLD if metal == "gold" else SILVER
    size = 640
    bg_top, bg_bottom = ((246, 241, 233), (226, 218, 204)) if metal == "gold" else ((236, 239, 243), (210, 216, 224))
    img = Image.new("RGB", (size, size), bg_top)
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / size
        d.line([(0, y), (size, y)], fill=tuple(int(bg_top[i] * (1 - t) + bg_bottom[i] * t) for i in range(3)))
    shadow = Image.new("L", (size, size), 0)
    ImageDraw.Draw(shadow).ellipse((150, 470, 490, 530), fill=90)
    img.paste((0, 0, 0), mask=shadow.filter(ImageFilter.GaussianBlur(18)))
    d = ImageDraw.Draw(img)
    c = size // 2
    if kind == "ring":
        _metal_stroke(d, "ellipse", (c - 150, c - 110, c + 150, c + 150), 34, pal)
        gem = [(214, 40, 60), (40, 110, 200), (30, 150, 90), (250, 250, 250)][seed % 4]
        d.polygon([(c, c - 175), (c + 42, c - 130), (c, c - 85), (c - 42, c - 130)], fill=gem, outline=pal[1])
        d.polygon([(c, c - 175), (c + 14, c - 130), (c, c - 85)], fill=tuple(min(255, v + 60) for v in gem))
    elif kind == "bracelet":
        _metal_stroke(d, "ellipse", (c - 200, c - 150, c + 200, c + 170), 26, pal)
        for a in range(0, 360, 30):
            x, y = c + 200 * math.cos(math.radians(a)), c + 10 + 160 * math.sin(math.radians(a))
            d.ellipse((x - 9, y - 9, x + 9, y + 9), fill=pal[3])
    elif kind == "chain":
        pts = [(c - 230 + i * 12, c - 120 + 200 * math.sin(i / 38 * math.pi)) for i in range(39)]
        for i, (x, y) in enumerate(pts):
            box = (x - 16, y - 10, x + 16, y + 10) if i % 2 else (x - 10, y - 14, x + 10, y + 14)
            _metal_stroke(d, "ellipse", box, 7, pal)
    elif kind == "pendant":
        _metal_stroke(d, "line", [(c - 200, c - 220), (c, c - 40), (c + 200, c - 220)], 6, pal)
        r = 80
        d.ellipse((c - r, c - 60, c + r, c + 100), fill=pal[1], outline=pal[0], width=6)
        d.ellipse((c - r + 22, c - 38, c + r - 22, c + 78), fill=pal[2])
        d.ellipse((c - 30, c - 20, c, c + 10), fill=pal[3])
    else:  # earrings
        for dx in (-110, 110):
            _metal_stroke(d, "ellipse", (c + dx - 22, c - 190, c + dx + 22, c - 146), 8, pal)
            d.polygon([(c + dx, c - 140), (c + dx + 55, c + 40), (c + dx, c + 120), (c + dx - 55, c + 40)], fill=pal[1], outline=pal[0])
            d.polygon([(c + dx, c - 120), (c + dx + 25, c + 40), (c + dx, c + 95)], fill=pal[2])
    img = img.filter(ImageFilter.SMOOTH)
    buf = BytesIO()
    img.save(buf, "JPEG", quality=86)
    return ContentFile(buf.getvalue(), name=f"{kind}-{seed}.jpg")


class Command(BaseCommand):
    help = "Create demo data (accounts, rates, stock with photos, suppliers, orders, bills, craftsmen)."

    @transaction.atomic
    def handle(self, *args, **options):
        if Order.objects.exists() or Bill.objects.exists() or StockItem.objects.exists():
            self.stdout.write(self.style.WARNING("Database already has data; nothing added."))
            return
        today = localdate()
        shop = ShopSettings.get()
        shop.shopName, shop.address, shop.phone = "Bijouterie Yasmine", "12 rue Didouche Mourad, Alger", "0550 12 34 56"
        shop.nif, shop.rc, shop.nis, shop.ai = "001216099876543", "16/00-1234567B21", "098716010012345", "16012345678"
        shop.invoiceFooter = "Merci pour votre confiance · شكرًا على ثقتكم"
        shop.save()

        owner, _ = User.objects.get_or_create(username="demo", defaults={
            "email": "demo@example.com", "full_name": "Karim Benali", "first_name": "Karim", "phone": "0550123456",
            "role": "owner", "is_staff": True, "is_superuser": True, "jobTitle": "Gérant"})
        owner.set_password("demo12345")
        owner.save()
        seller, _ = User.objects.get_or_create(username="vendeur", defaults={
            "email": "vendeur@example.com", "full_name": "Amina Hadj", "first_name": "Amina", "role": "employee", "jobTitle": "Vendeuse"})
        seller.set_password("vendeur12345")
        seller.save()

        g18, g21, g24, ag = (MetalGrade.objects.get(name=n) for n in ("Or 18K", "Or 21K", "Or 24K", "Argent 925"))
        base = {g18: (12600, 11200), g21: (14700, 13100), g24: (16800, 15000), ag: (230, 180)}
        for back in range(30, -1, -1):
            wiggle = 1 + 0.012 * math.sin(back / 4) - back * 0.0006
            for g, (sell, buy) in base.items():
                Rate.objects.update_or_create(date=today - timedelta(days=back), grade=g,
                                              defaults={"sellPrice": round(sell * wiggle, -1), "buyPrice": round(buy * wiggle, -1), "setBy": owner})

        s1 = Supplier.objects.create(name="Atelier El Djazair", company="SARL El Djazair Or", phone="0661 22 33 44",
                                     address="Bab Azzoun, Alger", nif="000916012345678", rc="16/00-7654321B12")
        s2 = Supplier.objects.create(name="Bijoux Constantine", company="EURL Cirta Bijoux", phone="0770 55 66 77", address="Constantine")
        s3 = Supplier.objects.create(name="Argent Tlemcen", phone="0555 98 76 54", address="Tlemcen")

        cats = [("Bague", "Bagues", "ring", 4.2, 1200), ("Bracelet", "Bracelets", "bracelet", 12.5, 900),
                ("Chaîne", "Chaînes", "chain", 8.0, 800), ("Pendentif", "Pendentifs", "pendant", 3.1, 1000),
                ("Boucles d'oreilles", "Boucles", "earrings", 3.6, 1100)]
        catalog = {}
        for i, (name, cat, kind, w, mk) in enumerate(cats):
            cp = CatalogProduct.objects.create(name=name, category=cat, grade=g18, netWeight=w, makingMode="perWeight", makingCharge=mk)
            cp.image.save(f"cat-{kind}.jpg", piece_photo(kind, "gold", i), save=True)
            catalog[kind] = cp

        models = [
            ("Bague solitaire", "ring", g18, 3.4, s1, "Zircon"), ("Bague torsadée", "ring", g18, 4.8, s1, ""),
            ("Alliance classique", "ring", g18, 5.2, s2, ""), ("Bague rubis", "ring", g21, 4.1, s2, "Rubis"),
            ("Bracelet Rihana", "bracelet", g18, 14.6, s1, ""), ("Bracelet maille", "bracelet", g21, 18.2, s2, ""),
            ("Jonc berbère", "bracelet", ag, 32.0, s3, ""), ("Chaîne forçat 50 cm", "chain", g18, 7.9, s1, ""),
            ("Chaîne gourmette", "chain", g18, 11.3, s2, ""), ("Collier Mejbed", "chain", g21, 21.5, s1, ""),
            ("Pendentif Khamsa", "pendant", g18, 2.6, s1, ""), ("Pendentif cœur", "pendant", g18, 2.2, s2, "Zircon"),
            ("Médaillon", "pendant", g24, 5.0, s1, ""), ("Boucles créoles", "earrings", g18, 3.9, s2, ""),
            ("Boucles kabyles", "earrings", ag, 9.5, s3, "Corail"), ("Boucles perle", "earrings", g18, 2.8, s1, "Perle"),
        ]
        items = []
        for i, (name, kind, g, w, sup, gem) in enumerate(models):
            sell = base[g][0]
            item = StockItem.objects.create(
                code=services.next_stock_code(), name=name, category=catalog[kind].category, catalog=catalog[kind], grade=g,
                weight=w, gemsName=gem, gemsPrice=2500 if gem else None, makingMode="perWeight",
                makingCharge=catalog[kind].makingCharge if g != ag else 60, costPrice=round(w * sell * 0.93, -1),
                supplier=sup, createdBy=owner)
            item.photo.save(f"{item.code}.jpg", piece_photo(kind, "silver" if g == ag else "gold", i + 7), save=True)
            items.append(item)

        services.save_purchase({"supplier": s1.supplierId, "reference": "FA-2026-118", "grade": g18.gradeId, "date": today - timedelta(days=12),
                                "lines": [{"name": "Lot bagues 18K", "quantity": 6, "weight": 24.6, "unitPrice": 11800, "makingCharge": 6000}],
                                "paidNow": 200000}, owner)
        services.save_purchase({"supplier": s2.supplierId, "reference": "BC-0457", "grade": g21.gradeId, "date": today - timedelta(days=5),
                                "lines": [{"name": "Bracelets maille 21K", "quantity": 2, "weight": 36.4, "unitPrice": 13900}]}, owner)
        services.add_supplier_payment({"supplier": s2.supplierId, "method": "metal", "metalWeight": 10, "metalGrade": g21.gradeId, "date": today - timedelta(days=2)}, owner)

        k1 = Staff.objects.create(staffName="Mohamed Saïdi", phone="0662 11 22 33", address="La Casbah, Alger", speciality="Bagues et sertissage")
        k2 = Staff.objects.create(staffName="Yacine Ouali", phone="0771 44 55 66", address="Tizi Ouzou", speciality="Bijoux kabyles")

        def cust(name, phone, address, email=""):
            return {"name": name, "phone": phone, "address": address, "email": email}

        def order(c, g, days, its, advance=0):
            return services.save_order({"customer": c, "order": {"grade": g.gradeId, "rate": base[g][0], "advanceAmount": advance,
                                                                 "dueDate": today + timedelta(days=days)}, "items": its}, owner)

        o1 = order(cust("Nadia Boualem", "0551 11 11 11", "Hydra, Alger", "nadia@example.com"), g18, -2,
                   [{"name": "Parure mariage", "netWeight": 25}, {"name": "Bague de fiançailles", "netWeight": 4, "gemsName": "Diamant"}], 150000)
        o2 = order(cust("Sofiane Meziane", "0552 22 22 22", "Bab Ezzouar"), g18, 3, [{"name": "Gourmette prénom", "netWeight": 9}], 30000)
        o3 = order(cust("Lila Khelifi", "0553 33 33 33", "Oran"), g21, 6, [{"name": "Mejbed", "netWeight": 30}], 100000)
        o4 = order(cust("Rachid Amrani", "0554 44 44 44", "Blida"), g18, 1, [{"name": "Chevalière", "netWeight": 12}], 50000)

        def give(o, i, k, extra, days):
            it = list(o.items.all())[i]
            return services.give_work({"staff": k.staffId, "orderItem": it.orderItemId, "givenWeight": it.netWeight, "addedWeight": extra,
                                       "dueDate": today + timedelta(days=days), "wage": 8000}, owner)

        give(o1, 0, k1, 0.6, -2)
        w = give(o1, 1, k2, 0.2, -1)
        services.receive_work(w, {"returnedWeight": 4.1}, owner)
        give(o2, 0, k1, 0.3, 2)
        w = give(o4, 0, k2, 0.4, 0)
        services.receive_work(w, {"returnedWeight": 12.2}, owner)

        def sell(c, lines, paid, days_ago=0, discount=0, metal=0, by=owner, order_id=None, advance=0):
            b = services.save_bill({"customer": c, "bill": {"orderId": order_id, "grade": g18.gradeId, "discount": discount, "paidAmount": paid,
                                                            "customerMetalWeight": metal, "advanceAmount": advance, "status": "submitted"},
                                    "items": lines}, by)
            Bill.objects.filter(pk=b.pk).update(date=today - timedelta(days=days_ago))
            return b

        def stock_line(item):
            return {"stockItem": item.itemId, "name": item.name, "grade": item.grade_id, "netWeight": item.weight,
                    "makingMode": item.makingMode, "makingCharge": item.makingCharge, "gemsName": item.gemsName, "gemsPrice": item.gemsPrice}

        b = sell(cust("Meriem Taleb", "0555 55 55 55", "Kouba"), [stock_line(items[0])], 0, days_ago=1, by=seller)
        services.add_bill_payment(b, {"amount": round(b.grandTotal, -2) - 100}, owner)
        sell(cust("Karima Djebbar", "0556 66 66 66", "Chéraga"), [stock_line(items[4]), stock_line(items[11])], 150000, days_ago=4, discount=2000, metal=3.5)
        sell(cust("Hocine Ait Ali", "0557 77 77 77", "Tizi Ouzou"), [stock_line(items[14])], 2000, days_ago=8)
        b = sell(cust("Samia Rahmani", "0558 88 88 88", "Alger Centre"), [stock_line(items[7])], 0, days_ago=0, by=seller)
        services.add_bill_payment(b, {"amount": b.remainingAmount, "method": "card"}, seller)
        self.stdout.write(self.style.SUCCESS("Demo data created. Owner: demo / demo12345 · Employee: vendeur / vendeur12345"))
