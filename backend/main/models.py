"""Data model.

Everything that depends on the country is a setting the owner can change (ShopSettings and MetalGrade):
the currency, the weight unit, what the daily price refers to (per gram, per 10 g, per tola...), the metals
and karats sold, tax, and what employees may do. Defaults suit an Algerian shop: grams and DZD.
"""
from io import BytesIO

import qrcode
from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.core.files.base import ContentFile
from django.core.mail import EmailMultiAlternatives
from django.db import models
from django.dispatch import receiver
from django.utils import timezone
from django.utils.timezone import localdate
from django_rest_passwordreset.signals import reset_password_token_created

CASCADE, PROTECT, SET_NULL = models.CASCADE, models.PROTECT, models.SET_NULL

MAKING_MODES = [("fixed", "Fixed amount per piece"), ("perWeight", "Per weight unit"), ("percent", "Percent of metal value")]
PAY_METHODS = [("cash", "Cash"), ("card", "Card"), ("cheque", "Cheque"), ("transfer", "Bank transfer"), ("metal", "Metal")]


# =========================================================================== shop
class ShopSettings(models.Model):
    """One row (pk=1). Read it with ShopSettings.get()."""

    shopName = models.CharField(max_length=80, default="Ma Bijouterie")
    address = models.CharField(max_length=200, blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    # Legal identifiers printed on invoices (Algeria: NIF, NIS, RC, Article d'imposition)
    nif = models.CharField(max_length=40, blank=True, default="")
    nis = models.CharField(max_length=40, blank=True, default="")
    rc = models.CharField(max_length=40, blank=True, default="")
    ai = models.CharField(max_length=40, blank=True, default="")
    logo = models.ImageField(upload_to="shop", null=True, blank=True)
    invoiceFooter = models.CharField(max_length=300, blank=True, default="")

    currencyCode = models.CharField(max_length=8, default="DZD")
    currencySymbol = models.CharField(max_length=8, default="DA")
    currencyDecimals = models.PositiveSmallIntegerField(default=2)
    weightUnit = models.CharField(max_length=12, default="g")
    weightDecimals = models.PositiveSmallIntegerField(default=2)
    # The daily price is for this many weight units (1 = per gram; 10 = per 10 g; 100 = per tola if you weigh in lal)
    priceQuantity = models.FloatField(default=1)
    defaultMakingMode = models.CharField(max_length=10, choices=MAKING_MODES, default="perWeight")
    taxLabel = models.CharField(max_length=20, default="TVA")
    taxRate = models.FloatField(default=0)  # percent, 0 = no tax line on the invoice

    employeesCanSetRates = models.BooleanField(default=True)
    employeesSeeSales = models.BooleanField(default=False)
    employeesCanDiscount = models.BooleanField(default=True)
    employeesSeeCost = models.BooleanField(default=False)
    stockCodePrefix = models.CharField(max_length=6, default="B")

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return self.shopName


class MetalGrade(models.Model):
    """A metal and its purity as the shop sells it: 'Or 18K', 'Or 21K', 'Argent 925', 'Plaqué or'..."""

    metals = [("gold", "Gold"), ("silver", "Silver"), ("platinum", "Platinum"), ("other", "Other")]
    gradeId = models.AutoField(primary_key=True)
    name = models.CharField(max_length=40)
    metal = models.CharField(max_length=10, choices=metals, default="gold")
    purity = models.FloatField(null=True, blank=True)  # e.g. 750 for 18K
    color = models.CharField(max_length=9, default="#c9a227")
    isActive = models.BooleanField(default=True)
    sortOrder = models.IntegerField(default=0)

    class Meta:
        ordering = ["sortOrder", "gradeId"]

    def __str__(self):
        return self.name


class Rate(models.Model):
    """Daily price of one grade: what you sell at and what you pay for old metal (cassé)."""

    rateId = models.AutoField(primary_key=True)
    date = models.DateField(default=localdate)
    grade = models.ForeignKey(MetalGrade, on_delete=CASCADE, related_name="rates")
    sellPrice = models.FloatField()
    buyPrice = models.FloatField(null=True, blank=True)
    setBy = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=SET_NULL, related_name="+")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["date", "grade"], name="one_rate_per_grade_per_day")]


# =========================================================================== people & security
class User(AbstractUser):
    """A login. role 'owner' sees and changes everything; 'employee' does the daily work."""

    roles = [("owner", "Owner"), ("employee", "Employee")]
    role = models.CharField(max_length=10, choices=roles, default="employee")
    full_name = models.CharField(max_length=60, blank=True, default="")
    phone = models.CharField(max_length=20, blank=True, default="")
    jobTitle = models.CharField(max_length=40, blank=True, default="")
    profileImage = models.ImageField(upload_to="users", null=True, blank=True)
    register_date = models.DateField(default=localdate, null=True, blank=True)
    # security
    failedLogins = models.PositiveIntegerField(default=0)
    lockedUntil = models.DateTimeField(null=True, blank=True)
    totpSecret = models.CharField(max_length=64, blank=True, default="")
    totpEnabled = models.BooleanField(default=False)
    tokenVersion = models.PositiveIntegerField(default=0)  # +1 signs this user out everywhere

    @property
    def is_owner(self):
        return self.role == "owner" or self.is_superuser

    @property
    def display_name(self):
        return self.full_name or self.get_full_name() or self.username


class LoginEvent(models.Model):
    user = models.ForeignKey(User, null=True, blank=True, on_delete=SET_NULL, related_name="logins")
    username = models.CharField(max_length=150, blank=True, default="")
    ip = models.CharField(max_length=64, blank=True, default="")
    userAgent = models.CharField(max_length=300, blank=True, default="")
    success = models.BooleanField(default=False)
    reason = models.CharField(max_length=40, blank=True, default="")
    at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-at"]


class Activity(models.Model):
    """Who did what, so several people can work at once and the owner can see it."""

    user = models.ForeignKey(User, null=True, blank=True, on_delete=SET_NULL, related_name="activities")
    action = models.CharField(max_length=40)  # e.g. bill.create
    objectType = models.CharField(max_length=20, blank=True, default="")
    objectId = models.IntegerField(null=True, blank=True)
    label = models.CharField(max_length=200, blank=True, default="")
    at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-id"]


class Customer(models.Model):
    customerId = models.AutoField(primary_key=True)
    name = models.CharField(max_length=80)
    address = models.CharField(max_length=120, blank=True, default="")
    phone = models.CharField(max_length=20, null=True, blank=True)
    email = models.EmailField(null=True, blank=True)
    note = models.CharField(max_length=300, blank=True, default="")
    createdAt = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.name


class Supplier(models.Model):
    """Fournisseur: who you buy finished jewellery or metal from."""

    supplierId = models.AutoField(primary_key=True)
    name = models.CharField(max_length=80)
    company = models.CharField(max_length=80, blank=True, default="")
    phone = models.CharField(max_length=20, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    address = models.CharField(max_length=160, blank=True, default="")
    nif = models.CharField(max_length=40, blank=True, default="")
    rc = models.CharField(max_length=40, blank=True, default="")
    note = models.CharField(max_length=300, blank=True, default="")
    photo = models.ImageField(upload_to="suppliers", null=True, blank=True)
    isActive = models.BooleanField(default=True)
    createdAt = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.name


class Staff(models.Model):
    """A craftsman (artisan) who makes pieces from metal you hand over."""

    staffId = models.AutoField(primary_key=True)
    staffName = models.CharField(max_length=60)
    address = models.CharField(max_length=120, blank=True, default="")
    phone = models.CharField(max_length=20, null=True, blank=True)
    email = models.EmailField(null=True, blank=True)
    speciality = models.CharField(max_length=60, blank=True, default="")
    photo = models.ImageField(upload_to="craftsmen", null=True, blank=True)
    registrationDate = models.DateField(null=True, blank=True, default=localdate)
    resignDate = models.DateField(null=True, blank=True)

    def __str__(self):
        return self.staffName


# =========================================================================== products
class CatalogProduct(models.Model):
    """A model/type of piece (ring, chain...) with usual values that pre-fill forms."""

    catalogId = models.AutoField(primary_key=True)
    name = models.CharField(max_length=60)
    category = models.CharField(max_length=40, blank=True, default="")
    grade = models.ForeignKey(MetalGrade, null=True, blank=True, on_delete=SET_NULL, related_name="+")
    netWeight = models.FloatField(null=True, blank=True)
    makingMode = models.CharField(max_length=10, choices=MAKING_MODES, default="perWeight")
    makingCharge = models.FloatField(null=True, blank=True)
    gemsName = models.CharField(max_length=60, blank=True, default="")
    gemsPrice = models.FloatField(null=True, blank=True)
    size = models.CharField(max_length=20, blank=True, default="")
    note = models.CharField(max_length=200, blank=True, default="")
    image = models.ImageField(upload_to="catalog", null=True, blank=True)
    isActive = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]


class StockItem(models.Model):
    """One physical piece in the shop window, with its photo. Selling it on a bill marks it sold."""

    statuses = [("instock", "In stock"), ("reserved", "Reserved"), ("sold", "Sold")]
    itemId = models.AutoField(primary_key=True)
    code = models.CharField(max_length=30, unique=True)
    name = models.CharField(max_length=60)
    category = models.CharField(max_length=40, blank=True, default="")
    catalog = models.ForeignKey(CatalogProduct, null=True, blank=True, on_delete=SET_NULL, related_name="stock")
    grade = models.ForeignKey(MetalGrade, null=True, blank=True, on_delete=PROTECT, related_name="stock")
    weight = models.FloatField()
    size = models.CharField(max_length=20, blank=True, default="")
    gemsName = models.CharField(max_length=60, blank=True, default="")
    gemsPrice = models.FloatField(null=True, blank=True)
    makingMode = models.CharField(max_length=10, choices=MAKING_MODES, default="perWeight")
    makingCharge = models.FloatField(null=True, blank=True)
    costPrice = models.FloatField(null=True, blank=True)
    supplier = models.ForeignKey(Supplier, null=True, blank=True, on_delete=SET_NULL, related_name="stock")
    photo = models.ImageField(upload_to="stock", null=True, blank=True)
    status = models.CharField(max_length=10, choices=statuses, default="instock")
    note = models.CharField(max_length=200, blank=True, default="")
    soldAt = models.DateField(null=True, blank=True)
    createdAt = models.DateTimeField(default=timezone.now)
    createdBy = models.ForeignKey(User, null=True, blank=True, on_delete=SET_NULL, related_name="+")
    version = models.PositiveIntegerField(default=1)


# =========================================================================== suppliers: purchases & payments
class Purchase(models.Model):
    purchaseId = models.AutoField(primary_key=True)
    supplier = models.ForeignKey(Supplier, on_delete=PROTECT, related_name="purchases")
    date = models.DateField(default=localdate)
    reference = models.CharField(max_length=40, blank=True, default="")  # supplier's invoice number
    grade = models.ForeignKey(MetalGrade, null=True, blank=True, on_delete=SET_NULL, related_name="+")
    note = models.CharField(max_length=300, blank=True, default="")
    totalWeight = models.FloatField(default=0)
    totalAmount = models.FloatField(default=0)
    createdBy = models.ForeignKey(User, null=True, blank=True, on_delete=SET_NULL, related_name="+")
    createdAt = models.DateTimeField(default=timezone.now)


class PurchaseLine(models.Model):
    purchase = models.ForeignKey(Purchase, on_delete=CASCADE, related_name="lines")
    name = models.CharField(max_length=60)
    quantity = models.FloatField(default=1)
    weight = models.FloatField(default=0)  # total weight of this line
    unitPrice = models.FloatField(default=0)  # price per priceQuantity weight units (like the daily rate)
    makingCharge = models.FloatField(default=0)  # extra, total for the line
    amount = models.FloatField(default=0)


class SupplierPayment(models.Model):
    paymentId = models.AutoField(primary_key=True)
    supplier = models.ForeignKey(Supplier, on_delete=PROTECT, related_name="payments")
    purchase = models.ForeignKey(Purchase, null=True, blank=True, on_delete=SET_NULL, related_name="payments")
    date = models.DateField(default=localdate)
    method = models.CharField(max_length=10, choices=PAY_METHODS, default="cash")
    amount = models.FloatField()
    metalWeight = models.FloatField(null=True, blank=True)  # when paying in metal
    metalGrade = models.ForeignKey(MetalGrade, null=True, blank=True, on_delete=SET_NULL, related_name="+")
    note = models.CharField(max_length=200, blank=True, default="")
    createdBy = models.ForeignKey(User, null=True, blank=True, on_delete=SET_NULL, related_name="+")


# =========================================================================== orders (custom pieces)
class Order(models.Model):
    order_status = [("pending", "PENDING"), ("inprogress", "INPROGRESS"), ("completed", "COMPLETED"), ("submitted", "SUBMITTED")]

    orderId = models.AutoField(primary_key=True)
    customer = models.ForeignKey(Customer, on_delete=PROTECT, related_name="orders")
    grade = models.ForeignKey(MetalGrade, null=True, blank=True, on_delete=PROTECT, related_name="+")
    date = models.DateField(default=localdate)
    rate = models.FloatField(null=True, blank=True)
    advanceAmount = models.FloatField(null=True, blank=True)
    dueDate = models.DateField(null=True, blank=True)  # promised date
    deliveredDate = models.DateField(null=True, blank=True)
    remark = models.TextField(blank=True, default="")
    customerMetalWeight = models.FloatField(null=True, blank=True)
    status = models.CharField(max_length=11, choices=order_status, default="pending")
    createdBy = models.ForeignKey(User, null=True, blank=True, on_delete=SET_NULL, related_name="+")
    updatedAt = models.DateTimeField(auto_now=True)
    version = models.PositiveIntegerField(default=1)


class OrderItem(models.Model):
    item_status = [("pending", "PENDING"), ("inprogress", "INPROGRESS"), ("completed", "COMPLETED")]

    orderItemId = models.AutoField(primary_key=True)
    order = models.ForeignKey(Order, on_delete=CASCADE, related_name="items")
    name = models.CharField(max_length=60)
    netWeight = models.FloatField(null=True, blank=True)
    size = models.CharField(max_length=20, blank=True, default="")
    gemsName = models.CharField(max_length=60, blank=True, default="")
    gemsPrice = models.FloatField(null=True, blank=True)
    quantity = models.FloatField(default=1)
    status = models.CharField(max_length=11, choices=item_status, default="pending")
    design = models.ImageField(null=True, blank=True, upload_to="designs")


class StaffWork(models.Model):
    work_status = [("inprogress", "INPROGRESS"), ("completed", "COMPLETED")]

    staffWorkId = models.AutoField(primary_key=True)
    staff = models.ForeignKey(Staff, on_delete=PROTECT, related_name="works")
    orderItem = models.ForeignKey(OrderItem, on_delete=CASCADE, related_name="works")
    date = models.DateField(default=localdate)
    givenWeight = models.FloatField()
    addedWeight = models.FloatField(default=0)  # solder / alloy added on top
    totalWeight = models.FloatField()
    dueDate = models.DateField(null=True, blank=True)
    returnedWeight = models.FloatField(null=True, blank=True)
    lossWeight = models.FloatField(null=True, blank=True)
    returnedDate = models.DateField(null=True, blank=True)
    wage = models.FloatField(null=True, blank=True)  # what you pay the craftsman for this piece
    status = models.CharField(max_length=11, choices=work_status, default="inprogress")
    createdBy = models.ForeignKey(User, null=True, blank=True, on_delete=SET_NULL, related_name="+")


# =========================================================================== bills (sales)
class Bill(models.Model):
    bill_status = [("draft", "DRAFT"), ("submitted", "SUBMITTED")]

    billId = models.AutoField(primary_key=True)
    order = models.ForeignKey(Order, null=True, blank=True, on_delete=SET_NULL, related_name="bills")
    customer = models.ForeignKey(Customer, null=True, blank=True, on_delete=PROTECT, related_name="bills")
    date = models.DateField(default=localdate)
    grade = models.ForeignKey(MetalGrade, null=True, blank=True, on_delete=PROTECT, related_name="+")
    rate = models.FloatField(null=True, blank=True)
    # old metal the customer hands in (cassé), bought back at buyRate
    customerMetalWeight = models.FloatField(default=0)
    customerMetalGrade = models.ForeignKey(MetalGrade, null=True, blank=True, on_delete=SET_NULL, related_name="+")
    buyRate = models.FloatField(null=True, blank=True)
    customerMetalAmount = models.FloatField(default=0)
    finalWeight = models.FloatField(default=0)
    subtotal = models.FloatField(default=0)
    discount = models.FloatField(default=0)
    taxRate = models.FloatField(default=0)
    taxAmount = models.FloatField(default=0)
    grandTotal = models.FloatField(default=0)
    advanceAmount = models.FloatField(default=0)
    paidAmount = models.FloatField(default=0)  # paid when the bill was made
    laterPaid = models.FloatField(default=0)  # sum of BillPayment rows
    remainingAmount = models.FloatField(default=0)
    payMethod = models.CharField(max_length=10, choices=PAY_METHODS, default="cash")
    status = models.CharField(max_length=11, choices=bill_status, default="submitted")
    note = models.CharField(max_length=300, blank=True, default="")
    qr_code = models.ImageField(upload_to="qr_code", blank=True)
    createdBy = models.ForeignKey(User, null=True, blank=True, on_delete=SET_NULL, related_name="+")
    createdAt = models.DateTimeField(default=timezone.now)
    updatedAt = models.DateTimeField(auto_now=True)
    version = models.PositiveIntegerField(default=1)

    def refresh_qr(self):
        shop = ShopSettings.get()
        data = (
            f"{shop.shopName}\nInvoice #{self.billId}\nDate {self.date}\n"
            f"Customer {self.customer.name if self.customer else '-'}\n"
            f"Total {self.grandTotal:.2f} {shop.currencyCode}\nRemaining {self.remainingAmount:.2f} {shop.currencyCode}"
        )
        buffer = BytesIO()
        qrcode.make(data).save(buffer, "PNG")
        if self.qr_code:
            self.qr_code.delete(save=False)
        self.qr_code.save(f"qr-{self.billId}.png", ContentFile(buffer.getvalue()), save=False)
        models.Model.save(self, update_fields=["qr_code"])


class BillLine(models.Model):
    lineId = models.AutoField(primary_key=True)
    bill = models.ForeignKey(Bill, on_delete=CASCADE, related_name="lines")
    stockItem = models.OneToOneField(StockItem, null=True, blank=True, on_delete=SET_NULL, related_name="billLine")
    name = models.CharField(max_length=60)
    grade = models.ForeignKey(MetalGrade, null=True, blank=True, on_delete=PROTECT, related_name="+")
    rate = models.FloatField(default=0)
    quantity = models.FloatField(default=1)
    netWeight = models.FloatField(default=0)  # per piece
    lossWeight = models.FloatField(default=0)  # for the whole line
    makingMode = models.CharField(max_length=10, choices=MAKING_MODES, default="perWeight")
    makingCharge = models.FloatField(default=0)
    gemsName = models.CharField(max_length=60, blank=True, default="")
    gemsPrice = models.FloatField(default=0)  # per piece
    size = models.CharField(max_length=20, blank=True, default="")
    totalWeight = models.FloatField(default=0)
    metalAmount = models.FloatField(default=0)
    makingAmount = models.FloatField(default=0)
    amount = models.FloatField(default=0)


class BillPayment(models.Model):
    """A payment made after the bill (the customer comes back and pays part of the balance)."""

    paymentId = models.AutoField(primary_key=True)
    bill = models.ForeignKey(Bill, on_delete=CASCADE, related_name="payments")
    date = models.DateField(default=localdate)
    amount = models.FloatField()
    method = models.CharField(max_length=10, choices=PAY_METHODS, default="cash")
    createdBy = models.ForeignKey(User, null=True, blank=True, on_delete=SET_NULL, related_name="+")
    createdAt = models.DateTimeField(default=timezone.now)


# =========================================================================== password reset mail
@receiver(reset_password_token_created)
def password_reset_token_created(sender, instance, reset_password_token, *args, **kwargs):
    shop = ShopSettings.get().shopName
    link = f"{settings.FRONTEND_URL}/reset-password?token={reset_password_token.key}"
    text = (
        f"{shop}: open this link to choose a new password: {link}\n"
        f"{shop} : ouvrez ce lien pour choisir un nouveau mot de passe : {link}\n"
        f"{shop}: افتح هذا الرابط لاختيار كلمة سر جديدة: {link}\n"
        "If you did not ask for this, ignore this email."
    )
    html = (
        '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">'
        f"<h2>{shop}</h2><p>Choose a new password · Choisir un nouveau mot de passe · اختيار كلمة سر جديدة</p>"
        f'<p><a href="{link}" style="background:#1f5f4a;color:#fff;padding:12px 20px;border-radius:8px;'
        'text-decoration:none;display:inline-block">OK</a></p></div>'
    )
    msg = EmailMultiAlternatives(f"{shop} – password", text, None, [reset_password_token.user.email])
    msg.attach_alternative(html, "text/html")
    msg.send()
