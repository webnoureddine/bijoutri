"""Input validation (what the API accepts) and presenters (what the API returns)."""
from django.contrib.auth.password_validation import validate_password
from django.utils.timezone import localdate
from rest_framework import serializers

from .models import (MAKING_MODES, PAY_METHODS, CatalogProduct, Customer, MetalGrade, ShopSettings, StockItem,
                     Staff, Supplier, User)

MODES = [m for m, _ in MAKING_MODES]
METHODS = [m for m, _ in PAY_METHODS]


def opt_float(**kw):
    return serializers.FloatField(required=False, allow_null=True, min_value=0, **kw)


def opt_char(max_length=60):
    return serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=max_length)


# =========================================================================== shop & users
class ShopIn(serializers.ModelSerializer):
    class Meta:
        model = ShopSettings
        exclude = ("id", "logo")

    def validate_priceQuantity(self, v):
        if v <= 0:
            raise serializers.ValidationError("Must be greater than zero.")
        return v


class GradeIn(serializers.ModelSerializer):
    class Meta:
        model = MetalGrade
        fields = ("name", "metal", "purity", "color", "isActive", "sortOrder")


class ProfileIn(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("full_name", "first_name", "last_name", "email", "phone", "jobTitle")

    def validate_email(self, value):
        value = (value or "").strip()
        if value and User.objects.filter(email__iexact=value).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("This email is already used by another account.")
        return value


class UserIn(ProfileIn):
    password = serializers.CharField(required=False, write_only=True)

    class Meta(ProfileIn.Meta):
        fields = ProfileIn.Meta.fields + ("username", "role", "is_active", "password")

    def validate_username(self, value):
        value = value.strip()
        if User.objects.filter(username__iexact=value).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("This username is taken.")
        return value

    def validate(self, attrs):
        if self.instance is None and not attrs.get("password"):
            raise serializers.ValidationError({"password": "Choose a password."})
        if attrs.get("password"):
            validate_password(attrs["password"])
        return attrs

    def create(self, data):
        password = data.pop("password")
        user = User(**data)
        user.set_password(password)
        user.save()
        return user

    def update(self, user, data):
        password = data.pop("password", None)
        for k, v in data.items():
            setattr(user, k, v)
        if password:
            user.set_password(password)
            user.tokenVersion += 1
        if "is_active" in data and not data["is_active"]:
            user.tokenVersion += 1
        user.save()
        return user


class ChangePasswordIn(serializers.Serializer):
    old_password = serializers.CharField()
    new_password = serializers.CharField()

    def validate_new_password(self, value):
        validate_password(value, user=self.context.get("user"))
        return value


class LoginIn(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(allow_blank=True)
    otp = serializers.CharField(required=False, allow_blank=True)
    remember = serializers.BooleanField(required=False, default=False)


# =========================================================================== people
class CustomerIn(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ("name", "address", "phone", "email", "note")
        extra_kwargs = {k: {"required": False, "allow_blank": True} for k in ("address", "note")}
        extra_kwargs.update({k: {"required": False, "allow_blank": True, "allow_null": True} for k in ("phone", "email")})

    def validate_name(self, v):
        v = v.strip()
        if not v:
            raise serializers.ValidationError("Enter the customer name.")
        return v

    def validate_phone(self, value):
        value = (value or "").strip() or None
        if value:
            clash = Customer.objects.filter(phone=value).exclude(pk=getattr(self.instance, "pk", None)).first()
            if clash:
                raise serializers.ValidationError(f"This phone already belongs to {clash.name}.")
        return value

    def validate_email(self, value):
        return (value or "").strip() or None


class CustomerRef(serializers.Serializer):
    """Customer on an order or bill: an existing id, or the details of a new customer."""

    customerId = serializers.IntegerField(required=False, allow_null=True)
    name = opt_char(80)
    address = opt_char(120)
    phone = opt_char(20)
    email = serializers.EmailField(required=False, allow_blank=True, allow_null=True)


class SupplierIn(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ("name", "company", "phone", "email", "address", "nif", "rc", "note", "isActive")
        extra_kwargs = {k: {"required": False, "allow_blank": True} for k in ("company", "phone", "email", "address", "nif", "rc", "note")}


class StaffIn(serializers.ModelSerializer):
    class Meta:
        model = Staff
        fields = ("staffName", "address", "phone", "email", "speciality", "registrationDate", "resignDate")
        extra_kwargs = {"address": {"required": False, "allow_blank": True}, "speciality": {"required": False, "allow_blank": True}}


# =========================================================================== products
class CatalogIn(serializers.ModelSerializer):
    grade = serializers.PrimaryKeyRelatedField(queryset=MetalGrade.objects.all(), required=False, allow_null=True)

    class Meta:
        model = CatalogProduct
        fields = ("name", "category", "grade", "netWeight", "makingMode", "makingCharge", "gemsName", "gemsPrice", "size", "note", "isActive")
        extra_kwargs = {
            **{k: {"min_value": 0} for k in ("netWeight", "makingCharge", "gemsPrice")},
            **{k: {"required": False, "allow_blank": True} for k in ("category", "gemsName", "size", "note")},
        }

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter the product name.")
        if CatalogProduct.objects.filter(name__iexact=value).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("A product with this name already exists.")
        return value


class StockIn(serializers.ModelSerializer):
    grade = serializers.PrimaryKeyRelatedField(queryset=MetalGrade.objects.all(), required=False, allow_null=True)
    supplier = serializers.PrimaryKeyRelatedField(queryset=Supplier.objects.all(), required=False, allow_null=True)
    catalog = serializers.PrimaryKeyRelatedField(queryset=CatalogProduct.objects.all(), required=False, allow_null=True)
    code = serializers.CharField(required=False, allow_blank=True, max_length=30)
    quantity = serializers.IntegerField(required=False, min_value=1, max_value=200, write_only=True)
    version = serializers.IntegerField(required=False, write_only=True)

    class Meta:
        model = StockItem
        fields = ("code", "name", "category", "catalog", "grade", "weight", "size", "gemsName", "gemsPrice", "makingMode",
                  "makingCharge", "costPrice", "supplier", "note", "status", "quantity", "version")
        extra_kwargs = {
            **{k: {"min_value": 0} for k in ("weight", "gemsPrice", "makingCharge", "costPrice")},
            **{k: {"required": False, "allow_blank": True} for k in ("category", "gemsName", "size", "note")},
        }

    def validate_code(self, value):
        value = (value or "").strip().upper()
        if value and StockItem.objects.filter(code__iexact=value).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("Another piece already has this code.")
        return value

    def validate_status(self, value):
        if value == "sold" and (self.instance is None or self.instance.status != "sold"):
            raise serializers.ValidationError("A piece becomes sold by putting it on a bill.")
        return value


# =========================================================================== orders, bills, work
class OrderItemIn(serializers.Serializer):
    orderItemId = serializers.IntegerField(required=False, allow_null=True)
    name = serializers.CharField(max_length=60)
    netWeight = opt_float()
    size = opt_char(20)
    gemsName = opt_char()
    gemsPrice = opt_float()
    quantity = opt_float()


class OrderIn(serializers.Serializer):
    date = serializers.DateField(required=False)
    grade = serializers.IntegerField(required=False, allow_null=True)
    rate = opt_float()
    advanceAmount = opt_float()
    dueDate = serializers.DateField()
    customerMetalWeight = opt_float()
    remark = serializers.CharField(required=False, allow_blank=True, allow_null=True)


class OrderPayload(serializers.Serializer):
    customer = CustomerRef()
    order = OrderIn()
    items = OrderItemIn(many=True, allow_empty=False)
    version = serializers.IntegerField(required=False)

    def validate(self, attrs):
        c = attrs["customer"]
        if not c.get("customerId") and not (c.get("name") or "").strip():
            raise serializers.ValidationError({"customer": "Pick a customer or enter a name."})
        return attrs


class BillLineIn(serializers.Serializer):
    lineId = serializers.IntegerField(required=False, allow_null=True)
    stockItem = serializers.IntegerField(required=False, allow_null=True)
    name = serializers.CharField(max_length=60)
    grade = serializers.IntegerField(required=False, allow_null=True)
    rate = opt_float()
    quantity = opt_float()
    netWeight = serializers.FloatField(min_value=0)
    lossWeight = opt_float()
    makingMode = serializers.ChoiceField(choices=MODES, required=False)
    makingCharge = opt_float()
    gemsName = opt_char()
    gemsPrice = opt_float()
    size = opt_char(20)


class BillIn(serializers.Serializer):
    orderId = serializers.IntegerField(required=False, allow_null=True)
    date = serializers.DateField(required=False)
    grade = serializers.IntegerField(required=False, allow_null=True)
    rate = opt_float()
    customerMetalWeight = opt_float()
    customerMetalGrade = serializers.IntegerField(required=False, allow_null=True)
    buyRate = opt_float()
    discount = opt_float()
    advanceAmount = opt_float()
    paidAmount = opt_float()
    payMethod = serializers.ChoiceField(choices=METHODS, required=False, default="cash")
    status = serializers.ChoiceField(choices=["draft", "submitted"], default="submitted")
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)


class BillPayload(serializers.Serializer):
    customer = CustomerRef(required=False, default=dict)
    bill = BillIn()
    items = BillLineIn(many=True, allow_empty=False)
    version = serializers.IntegerField(required=False)


class PaymentIn(serializers.Serializer):
    amount = serializers.FloatField(min_value=0.01)
    method = serializers.ChoiceField(choices=METHODS, required=False, default="cash")
    date = serializers.DateField(required=False)


class StatusIn(serializers.Serializer):
    status = serializers.ChoiceField(choices=["pending", "inprogress", "completed", "submitted"])


class WorkIn(serializers.Serializer):
    staff = serializers.IntegerField()
    orderItem = serializers.IntegerField(required=False)
    date = serializers.DateField(required=False)
    givenWeight = serializers.FloatField(min_value=0.0001)
    addedWeight = opt_float()
    dueDate = serializers.DateField(required=False, allow_null=True)
    wage = opt_float()


class WorkReturnIn(serializers.Serializer):
    returnedWeight = serializers.FloatField(min_value=0)
    lossWeight = opt_float()
    returnedDate = serializers.DateField(required=False, allow_null=True)
    wage = opt_float()


class RateRowIn(serializers.Serializer):
    grade = serializers.IntegerField()
    sellPrice = serializers.FloatField(min_value=0.0001)
    buyPrice = opt_float()


class RatesIn(serializers.Serializer):
    date = serializers.DateField(required=False)
    rates = RateRowIn(many=True, allow_empty=False)


class PurchaseLineIn(serializers.Serializer):
    name = serializers.CharField(max_length=60)
    quantity = opt_float()
    weight = serializers.FloatField(min_value=0)
    unitPrice = opt_float()
    makingCharge = opt_float()
    addToStock = serializers.BooleanField(required=False, default=False)


class PurchaseIn(serializers.Serializer):
    supplier = serializers.IntegerField()
    date = serializers.DateField(required=False)
    reference = serializers.CharField(required=False, allow_blank=True, max_length=40)
    grade = serializers.IntegerField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, max_length=300)
    lines = PurchaseLineIn(many=True, allow_empty=False)
    paidNow = opt_float()
    payMethod = serializers.ChoiceField(choices=METHODS, required=False, default="cash")


class SupplierPaymentIn(serializers.Serializer):
    supplier = serializers.IntegerField()
    purchase = serializers.IntegerField(required=False, allow_null=True)
    date = serializers.DateField(required=False)
    method = serializers.ChoiceField(choices=METHODS, default="cash")
    amount = opt_float()
    metalWeight = opt_float()
    metalGrade = serializers.IntegerField(required=False, allow_null=True)
    metalRate = opt_float()
    note = serializers.CharField(required=False, allow_blank=True, max_length=200)


# =========================================================================== presenters
def file_url(request, f):
    if not f:
        return None
    try:
        url = f.url
    except ValueError:
        return None
    return request.build_absolute_uri(url) if request and url.startswith("/") else url


def user_brief(u):
    if u is None:
        return None
    return {"id": u.id, "name": u.display_name}


def user_out(u, request=None):
    return {
        "id": u.id, "username": u.username, "full_name": u.full_name, "first_name": u.first_name, "last_name": u.last_name,
        "email": u.email, "phone": u.phone, "jobTitle": u.jobTitle, "role": "owner" if u.is_owner else "employee",
        "is_active": u.is_active, "register_date": u.register_date, "last_login": u.last_login,
        "profileImage": file_url(request, u.profileImage), "totpEnabled": u.totpEnabled, "name": u.display_name,
    }


def shop_out(s, request=None):
    data = {f.name: getattr(s, f.name) for f in ShopSettings._meta.fields if f.name not in ("id", "logo")}
    data["logo"] = file_url(request, s.logo)
    return data


def grade_out(g):
    if g is None:
        return None
    return {"gradeId": g.gradeId, "name": g.name, "metal": g.metal, "purity": g.purity, "color": g.color,
            "isActive": g.isActive, "sortOrder": g.sortOrder}


def rate_out(r):
    return {"rateId": r.rateId, "date": r.date, "grade": r.grade_id, "gradeName": r.grade.name,
            "sellPrice": r.sellPrice, "buyPrice": r.buyPrice}


def customer_brief(c):
    if c is None:
        return None
    return {"customerId": c.customerId, "name": c.name, "address": c.address, "phone": c.phone, "email": c.email, "note": c.note}


def supplier_out(s, request=None, balance=None):
    return {
        "supplierId": s.supplierId, "name": s.name, "company": s.company, "phone": s.phone, "email": s.email,
        "address": s.address, "nif": s.nif, "rc": s.rc, "note": s.note, "isActive": s.isActive,
        "photo": file_url(request, s.photo), "balance": balance,
    }


def staff_out(s, request=None):
    works = list(s.works.all())
    return {
        "staffId": s.staffId, "staffName": s.staffName, "address": s.address, "phone": s.phone, "email": s.email,
        "speciality": s.speciality, "photo": file_url(request, s.photo), "registrationDate": s.registrationDate,
        "resignDate": s.resignDate, "totalWork": len(works),
        "inprogress": sum(1 for w in works if w.status == "inprogress"),
        "completed": sum(1 for w in works if w.status == "completed"),
        "weightOut": round(sum(w.totalWeight for w in works if w.status == "inprogress"), 3),
        "totalLoss": round(sum(w.lossWeight or 0 for w in works), 3),
        "totalWages": round(sum(w.wage or 0 for w in works), 2),
    }


def catalog_out(c, request=None):
    return {
        "catalogId": c.catalogId, "name": c.name, "category": c.category, "grade": c.grade_id,
        "netWeight": c.netWeight, "makingMode": c.makingMode, "makingCharge": c.makingCharge, "gemsName": c.gemsName,
        "gemsPrice": c.gemsPrice, "size": c.size, "note": c.note, "image": file_url(request, c.image), "isActive": c.isActive,
        "inStock": getattr(c, "inStock", None),
    }


def stock_out(i, request=None, show_cost=True):
    line = getattr(i, "billLine", None) if i.status != "instock" else None
    return {
        "itemId": i.itemId, "code": i.code, "name": i.name, "category": i.category, "catalog": i.catalog_id,
        "grade": i.grade_id, "gradeName": i.grade.name if i.grade else None, "weight": i.weight, "size": i.size,
        "gemsName": i.gemsName, "gemsPrice": i.gemsPrice, "makingMode": i.makingMode, "makingCharge": i.makingCharge,
        "costPrice": i.costPrice if show_cost else None, "supplier": i.supplier_id,
        "supplierName": i.supplier.name if i.supplier else None, "photo": file_url(request, i.photo),
        "status": i.status, "note": i.note, "soldAt": i.soldAt, "createdAt": i.createdAt, "version": i.version,
        "billId": line.bill_id if line else None,
    }


def _is_overdue(order):
    return bool(order.dueDate and order.status in ("pending", "inprogress", "completed") and order.dueDate < localdate())


def _main_bill(order):
    bills = list(order.bills.all())
    return next((b for b in bills if b.status == "submitted"), bills[0] if bills else None)


def order_summary(o):
    bill = _main_bill(o)
    return {
        "orderId": o.orderId, "date": o.date, "grade": o.grade_id, "gradeName": o.grade.name if o.grade else None,
        "status": o.status, "customer": customer_brief(o.customer), "itemCount": len(o.items.all()),
        "advanceAmount": o.advanceAmount, "dueDate": o.dueDate, "deliveredDate": o.deliveredDate,
        "isOverdue": _is_overdue(o), "billId": bill.billId if bill else None, "billStatus": bill.status if bill else None,
        "createdBy": user_brief(o.createdBy),
    }


def work_brief(w):
    return {"staffWorkId": w.staffWorkId, "staffId": w.staff_id, "staffName": w.staff.staffName, "status": w.status, "dueDate": w.dueDate}


def order_item_out(it, request=None):
    work = next(iter(sorted(it.works.all(), key=lambda w: -w.staffWorkId)), None)
    return {
        "orderItemId": it.orderItemId, "name": it.name, "netWeight": it.netWeight, "size": it.size,
        "gemsName": it.gemsName, "gemsPrice": it.gemsPrice, "quantity": it.quantity, "status": it.status,
        "design": file_url(request, it.design), "work": work_brief(work) if work else None,
    }


def order_detail(o, request=None):
    data = order_summary(o)
    data.update({
        "rate": o.rate, "remark": o.remark, "customerMetalWeight": o.customerMetalWeight, "version": o.version,
        "items": [order_item_out(it, request) for it in o.items.all()],
        "bills": [{"billId": b.billId, "status": b.status, "grandTotal": b.grandTotal, "remainingAmount": b.remainingAmount, "date": b.date} for b in o.bills.all()],
    })
    return data


def bill_line_out(l, request=None):
    return {
        "lineId": l.lineId, "stockItem": l.stockItem_id, "name": l.name, "grade": l.grade_id,
        "gradeName": l.grade.name if l.grade else None, "rate": l.rate, "quantity": l.quantity, "netWeight": l.netWeight,
        "lossWeight": l.lossWeight, "makingMode": l.makingMode, "makingCharge": l.makingCharge, "gemsName": l.gemsName,
        "gemsPrice": l.gemsPrice, "size": l.size, "totalWeight": l.totalWeight, "metalAmount": l.metalAmount,
        "makingAmount": l.makingAmount, "amount": l.amount,
        "photo": file_url(request, l.stockItem.photo) if l.stockItem_id and l.stockItem else None,
        "code": l.stockItem.code if l.stockItem_id and l.stockItem else None,
    }


def bill_summary(b):
    return {
        "billId": b.billId, "orderId": b.order_id, "date": b.date, "grade": b.grade_id, "status": b.status,
        "customer": customer_brief(b.customer), "itemCount": len(b.lines.all()), "finalWeight": b.finalWeight,
        "grandTotal": b.grandTotal, "advanceAmount": b.advanceAmount, "paidAmount": b.paidAmount,
        "laterPaid": b.laterPaid, "remainingAmount": b.remainingAmount,
        "paymentStatus": "due" if b.remainingAmount > 0.005 else "paid", "createdBy": user_brief(b.createdBy),
    }


def bill_detail(b, request=None):
    data = bill_summary(b)
    data.update({
        "rate": b.rate, "customerMetalWeight": b.customerMetalWeight, "customerMetalGrade": b.customerMetalGrade_id,
        "buyRate": b.buyRate, "customerMetalAmount": b.customerMetalAmount, "subtotal": b.subtotal,
        "discount": b.discount, "taxRate": b.taxRate, "taxAmount": b.taxAmount, "payMethod": b.payMethod,
        "note": b.note, "version": b.version, "qr_code": file_url(request, b.qr_code),
        "lines": [bill_line_out(l, request) for l in b.lines.all()],
        "payments": [{"paymentId": p.paymentId, "date": p.date, "amount": p.amount, "method": p.method,
                      "by": user_brief(p.createdBy)} for p in b.payments.all()],
    })
    return data


def work_out(w):
    it = w.orderItem
    order = it.order
    return {
        "staffWorkId": w.staffWorkId, "staff": {"staffId": w.staff_id, "staffName": w.staff.staffName, "phone": w.staff.phone},
        "orderId": order.orderId, "gradeName": order.grade.name if order.grade else None,
        "item": {"orderItemId": it.orderItemId, "name": it.name, "netWeight": it.netWeight},
        "date": w.date, "givenWeight": w.givenWeight, "addedWeight": w.addedWeight, "totalWeight": w.totalWeight,
        "dueDate": w.dueDate, "returnedDate": w.returnedDate, "returnedWeight": w.returnedWeight, "lossWeight": w.lossWeight,
        "wage": w.wage, "status": w.status,
        "isOverdue": bool(w.status == "inprogress" and w.dueDate and w.dueDate < localdate()),
    }


def purchase_out(p, detail=False):
    paid = round(sum(x.amount for x in p.payments.all()), 2)
    data = {
        "purchaseId": p.purchaseId, "supplier": p.supplier_id, "supplierName": p.supplier.name, "date": p.date,
        "reference": p.reference, "grade": p.grade_id, "note": p.note, "totalWeight": p.totalWeight,
        "totalAmount": p.totalAmount, "paid": paid, "remaining": round(p.totalAmount - paid, 2),
        "lineCount": len(p.lines.all()), "createdBy": user_brief(p.createdBy),
    }
    if detail:
        data["lines"] = [{"name": l.name, "quantity": l.quantity, "weight": l.weight, "unitPrice": l.unitPrice,
                          "makingCharge": l.makingCharge, "amount": l.amount} for l in p.lines.all()]
    return data


def supplier_payment_out(p):
    return {
        "paymentId": p.paymentId, "supplier": p.supplier_id, "purchase": p.purchase_id, "date": p.date,
        "method": p.method, "amount": p.amount, "metalWeight": p.metalWeight, "metalGrade": p.metalGrade_id,
        "note": p.note, "by": user_brief(p.createdBy),
    }


def activity_out(a):
    return {"id": a.id, "user": user_brief(a.user), "action": a.action, "objectType": a.objectType,
            "objectId": a.objectId, "label": a.label, "at": a.at}
