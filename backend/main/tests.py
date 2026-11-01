import shutil
import tempfile
from datetime import timedelta

import pyotp
from django.core import mail
from django.test import override_settings
from django.utils.timezone import localdate
from rest_framework.test import APITestCase

from . import calc
from .models import Bill, Customer, MetalGrade, Order, Rate, ShopSettings, Staff, StockItem, Supplier, User

TMP_MEDIA = tempfile.mkdtemp()
PW = "S3cretPass!x"


class CalcTests(APITestCase):
    def test_line_modes(self):
        # per gram making: 10 g x 1000 + 10 g x 100
        self.assertEqual(calc.line_totals(10, 1, 0, 1000, "perWeight", 100, 0)["amount"], 11000)
        # fixed making is per piece; quantity multiplies weight, making and stones
        t = calc.line_totals(2, 3, 0.5, 1000, "fixed", 300, 50)
        self.assertEqual(t["totalWeight"], 6.5)
        self.assertEqual(t["amount"], 6500 + 900 + 150)
        # percent of the metal value
        self.assertEqual(calc.line_totals(10, 1, 0, 1000, "percent", 10, 0)["amount"], 11000)
        # price per tola when weighing in lal (pq = 100)
        self.assertEqual(calc.line_totals(150, 1, 0, 100000, "fixed", 0, 0, pq=100)["amount"], 150000)

    def test_bill_totals(self):
        lines = [calc.line_totals(10, 1, 0, 1000, "fixed", 0, 0)]
        t = calc.bill_totals(lines, customer_weight=2, buy_rate=900, discount=1000, tax_rate=10, advance=500, paid=1000, later=100)
        self.assertEqual(t["subtotal"], 10000)
        self.assertEqual(t["taxAmount"], 900)  # 10% of (10000 - 1000)
        self.assertEqual(t["customerMetalAmount"], 1800)
        self.assertEqual(t["grandTotal"], 9000 + 900 - 1800)
        self.assertEqual(t["remainingAmount"], 8100 - 500 - 1000 - 100)

    def test_none_values(self):
        self.assertEqual(calc.line_totals(None, None, None, None, None, None, None)["amount"], 0)


@override_settings(MEDIA_ROOT=TMP_MEDIA, REST_FRAMEWORK={
    "DEFAULT_AUTHENTICATION_CLASSES": ["main.security.VersionedJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_RATES": {"login": "1000/min"}})
class ApiTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TMP_MEDIA, ignore_errors=True)

    def setUp(self):
        from django.core.cache import cache
        cache.clear()  # login rate limit counts are kept in the cache
        self.owner = User.objects.create_user("owner", "owner@example.com", PW, role="owner", full_name="Owner")
        self.emp = User.objects.create_user("emp", "emp@example.com", PW, role="employee", full_name="Emp")
        self.client.force_authenticate(self.owner)
        self.g18 = MetalGrade.objects.get(name="Or 18K")
        Rate.objects.create(grade=self.g18, sellPrice=10000, buyPrice=9000)
        self.due = str(localdate() + timedelta(days=5))

    def as_(self, user):
        self.client.force_authenticate(user)

    def place_order(self, name="Nadia", phone="0551000001", email="n@example.com"):
        res = self.client.post("/api/orders/", {
            "customer": {"name": name, "phone": phone, "email": email},
            "order": {"grade": self.g18.gradeId, "rate": 10000, "advanceAmount": 5000, "dueDate": self.due},
            "items": [{"name": "Ring", "netWeight": 5}, {"name": "Chain", "netWeight": 12}]}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        return res.data

    def stock_item(self, **kw):
        res = self.client.post("/api/stock/", {"name": "Bague", "grade": self.g18.gradeId, "weight": 4, "makingMode": "perWeight",
                                               "makingCharge": 1000, "costPrice": 35000, **kw}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        return res.data[0]

    def sell(self, item, **bill):
        return self.client.post("/api/bills/", {
            "customer": {"name": "Client"},
            "bill": {"grade": self.g18.gradeId, "status": "submitted", **bill},
            "items": [{"stockItem": item["itemId"], "name": item["name"], "netWeight": item["weight"], "makingMode": "perWeight", "makingCharge": 1000}]},
            format="json")

    # ------------------------------------------------------------------ login security
    def test_login_lockout_and_history(self):
        self.client.force_authenticate(None)
        for _ in range(5):
            self.assertEqual(self.client.post("/api/auth/login/", {"username": "emp", "password": "bad"}, format="json").status_code, 401)
        res = self.client.post("/api/auth/login/", {"username": "emp", "password": PW}, format="json")
        self.assertEqual(res.status_code, 429)  # locked even with the right password
        User.objects.filter(pk=self.emp.pk).update(lockedUntil=None)
        res = self.client.post("/api/auth/login/", {"username": "emp@example.com", "password": PW}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["user"]["role"], "employee")
        self.assertTrue(self.emp.logins.filter(success=True).exists())

    def test_two_step_login(self):
        secret = pyotp.random_base32()
        User.objects.filter(pk=self.owner.pk).update(totpSecret=secret, totpEnabled=True)
        self.client.force_authenticate(None)
        res = self.client.post("/api/auth/login/", {"username": "owner", "password": PW}, format="json")
        self.assertEqual(res.data, {"otpRequired": True})
        bad = self.client.post("/api/auth/login/", {"username": "owner", "password": PW, "otp": "000000"}, format="json")
        self.assertEqual(bad.status_code, 401)
        ok = self.client.post("/api/auth/login/", {"username": "owner", "password": PW, "otp": pyotp.TOTP(secret).now()}, format="json")
        self.assertIn("access", ok.data)

    def test_sign_out_everywhere_revokes_tokens(self):
        self.client.force_authenticate(None)
        tokens = self.client.post("/api/auth/login/", {"username": "emp", "password": PW}, format="json").data
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)
        self.client.credentials()
        self.as_(self.owner)
        self.client.post(f"/api/users/{self.emp.pk}/signout/")
        self.client.force_authenticate(None)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        self.client.credentials()
        self.assertEqual(self.client.post("/api/auth/refresh/", {"refresh": tokens["refresh"]}, format="json").status_code, 401)

    def test_endpoints_require_login(self):
        self.client.force_authenticate(None)
        for url in ("/api/customers/", "/api/orders/", "/api/bills/", "/api/stock/", "/api/dashboard/", "/api/auth/me/"):
            self.assertEqual(self.client.get(url).status_code, 401, url)

    # ------------------------------------------------------------------ permissions
    def test_employee_limits(self):
        self.as_(self.emp)
        for url in ("/api/users/", "/api/suppliers/", "/api/activity/", "/api/backup/", "/api/reports/sales/"):
            self.assertEqual(self.client.get(url).status_code, 403, url)
        self.assertEqual(self.client.patch("/api/shop/", {"shopName": "X"}, format="json").status_code, 403)
        self.assertNotIn("money", self.client.get("/api/dashboard/").data)
        item = self.stock_item()
        self.assertIsNone(item["costPrice"])  # cost hidden from employees
        res = self.sell(item, discount=100)
        self.assertEqual(res.status_code, 201)  # discounts allowed by default
        ShopSettings.objects.filter(pk=1).update(employeesCanDiscount=False)
        item2 = self.stock_item()
        self.assertEqual(self.sell(item2, discount=100).status_code, 403)
        bill = self.sell(item2).data
        # employees cannot edit or delete a saved bill
        self.assertEqual(self.client.delete(f"/api/bills/{bill['billId']}/").status_code, 403)

    def test_owner_manages_users(self):
        res = self.client.post("/api/users/", {"username": "new", "password": PW, "full_name": "New", "role": "employee"}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        res = self.client.patch(f"/api/users/{self.owner.pk}/", {"role": "employee"}, format="json")
        self.assertEqual(res.status_code, 400)  # last owner

    # ------------------------------------------------------------------ customers
    def test_same_phone_different_name_is_not_renamed(self):
        self.place_order("Sita", "0611")
        res = self.client.post("/api/orders/", {"customer": {"name": "Karim", "phone": "0611"},
                                                "order": {"dueDate": self.due}, "items": [{"name": "Ring"}]}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(Customer.objects.get(phone="0611").name, "Sita")
        # same name + phone reuses the customer
        self.place_order("sita", "0611")
        self.assertEqual(Customer.objects.count(), 1)

    # ------------------------------------------------------------------ stock & bills
    def test_sell_from_stock_and_no_double_sale(self):
        item = self.stock_item()
        res = self.sell(item, paidAmount=10000)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["grandTotal"], 4 * 10000 + 4 * 1000)  # rate taken from today's 18K price
        self.assertEqual(StockItem.objects.get(pk=item["itemId"]).status, "sold")
        again = self.sell(item)
        self.assertEqual(again.status_code, 400)
        # deleting the bill puts the piece back in stock
        self.client.delete(f"/api/bills/{res.data['billId']}/")
        self.assertEqual(StockItem.objects.get(pk=item["itemId"]).status, "instock")

    def test_old_gold_and_payments(self):
        item = self.stock_item()
        bill = self.sell(item, customerMetalWeight=2, paidAmount=1000).data
        self.assertEqual(bill["customerMetalAmount"], 18000)  # buy price 9000/g
        self.assertEqual(bill["remainingAmount"], 44000 - 18000 - 1000)
        res = self.client.post(f"/api/bills/{bill['billId']}/payments/", {"amount": 99999}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.client.post(f"/api/bills/{bill['billId']}/payments/", {"amount": 25000, "method": "card"}, format="json")
        self.assertEqual(res.data["remainingAmount"], 0)
        self.assertEqual(len(res.data["payments"]), 1)

    def test_edit_conflict(self):
        item = self.stock_item()
        bill = self.sell(item).data
        body = {"customer": {}, "bill": {"grade": self.g18.gradeId, "discount": 10}, "version": bill["version"],
                "items": [{"lineId": bill["lines"][0]["lineId"], "stockItem": item["itemId"], "name": "Bague", "netWeight": 4}]}
        self.assertEqual(self.client.put(f"/api/bills/{bill['billId']}/", body, format="json").status_code, 200)
        self.assertEqual(self.client.put(f"/api/bills/{bill['billId']}/", body, format="json").status_code, 409)  # stale version

    # ------------------------------------------------------------------ orders & craftsmen
    def test_order_lifecycle(self):
        order = self.place_order()
        k = Staff.objects.create(staffName="Mohamed")
        ids = [i["orderItemId"] for i in order["items"]]
        works = []
        for it in ids:
            res = self.client.post("/api/work/", {"staff": k.staffId, "orderItem": it, "givenWeight": 5, "addedWeight": 0.5}, format="json")
            self.assertEqual(res.status_code, 201, res.data)
            works.append(res.data["staffWorkId"])
        dup = self.client.post("/api/work/", {"staff": k.staffId, "orderItem": ids[0], "givenWeight": 5}, format="json")
        self.assertEqual(dup.status_code, 400)
        res = self.client.post("/api/orders/%d/status/" % order["orderId"], {"status": "pending"}, format="json")
        self.assertEqual(res.status_code, 400)  # status follows the items
        with self.captureOnCommitCallbacks(execute=True):
            for w in works:
                r = self.client.post(f"/api/work/{w}/receive/", {"returnedWeight": 5.3}, format="json")
                self.assertAlmostEqual(r.data["lossWeight"], 0.2)
        self.assertEqual(Order.objects.get(pk=order["orderId"]).status, "completed")
        self.assertEqual(len(mail.outbox), 1)
        bill = self.client.post("/api/bills/", {"bill": {"orderId": order["orderId"], "grade": self.g18.gradeId, "rate": 10000, "advanceAmount": 5000},
                                                "items": [{"name": "Ring", "netWeight": 5}]}, format="json")
        self.assertEqual(bill.status_code, 201, bill.data)
        self.assertEqual(Order.objects.get(pk=order["orderId"]).status, "submitted")

    # ------------------------------------------------------------------ suppliers
    def test_supplier_balance(self):
        sup = Supplier.objects.create(name="Atelier")
        res = self.client.post("/api/purchases/", {"supplier": sup.supplierId, "grade": self.g18.gradeId, "paidNow": 10000,
                                                   "lines": [{"name": "Bagues", "quantity": 2, "weight": 8, "unitPrice": 9000, "addToStock": True}]}, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["totalAmount"], 72000)
        self.assertEqual(StockItem.objects.filter(supplier=sup).count(), 2)
        self.client.post("/api/supplier-payments/", {"supplier": sup.supplierId, "method": "metal", "metalWeight": 2, "metalGrade": self.g18.gradeId}, format="json")
        detail = self.client.get(f"/api/suppliers/{sup.supplierId}/").data
        self.assertEqual(detail["balance"], 72000 - 10000 - 20000)

    def test_custom_units(self):
        ShopSettings.objects.filter(pk=1).update(weightUnit="lal", priceQuantity=100)
        item = self.stock_item(weight=150, makingMode="fixed", makingCharge=0)
        Rate.objects.filter(grade=self.g18).update(sellPrice=100000)
        bill = self.sell(item).data
        self.assertEqual(bill["lines"][0]["metalAmount"], 150000)
