import base64
import calendar
import io
import json
from collections import Counter
from datetime import date as Date, timedelta

import pyotp
import qrcode
from django.core import management
from django.db.models import Count, Q, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.timezone import localdate
from PIL import Image
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes, throttle_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from . import security
from . import serializers as s
from . import services
from .models import (Activity, Bill, BillPayment, CatalogProduct, Customer, LoginEvent, MetalGrade, Order, OrderItem,
                     Purchase, Rate, ShopSettings, Staff, StaffWork, StockItem, Supplier, SupplierPayment, User)
from .security import IsOwner, OwnerForWrites

ANY_PARSERS = [JSONParser, MultiPartParser, FormParser]


# =========================================================================== helpers
class Page(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 200

    def get_paginated_response(self, data):
        return Response({"count": self.page.paginator.count, "totalPages": self.page.paginator.num_pages,
                         "page": self.page.number, "results": data})


def paginate(request, queryset, present, size=20):
    paginator = Page()
    paginator.page_size = size
    page = paginator.paginate_queryset(queryset, request)
    return paginator.get_paginated_response([present(obj) for obj in page])


def param(request, name, default=""):
    return (request.query_params.get(name) or default).strip()


def parse_date(value, field="date"):
    if not value:
        return None
    try:
        return Date.fromisoformat(value)
    except ValueError:
        raise ValidationError({field: "Use the format YYYY-MM-DD."})


def take_image(request, field, max_mb=8):
    """Validated uploaded image, or None if the field is missing."""
    f = request.FILES.get(field)
    if f is None:
        return None
    if not (f.content_type or "").startswith("image/"):
        raise ValidationError({field: "Only image files are allowed."})
    if f.size > max_mb * 1024 * 1024:
        raise ValidationError({field: f"The photo must be smaller than {max_mb} MB."})
    try:
        Image.open(f).verify()
    except Exception:  # noqa: BLE001
        raise ValidationError({field: "This file is not a valid image."})
    f.seek(0)
    return f


def set_photo(request, obj, attr, field="image"):
    """Shared upload / remove handler for every photo field."""
    if request.data.get("remove") in ("1", "true", 1, True):
        old = getattr(obj, attr)
        if old:
            old.delete(save=False)
        setattr(obj, attr, None)
        obj.save(update_fields=[attr])
        return
    image = take_image(request, field)
    if image is None:
        raise ValidationError({field: "Choose an image file."})
    old = getattr(obj, attr)
    if old:
        old.delete(save=False)
    setattr(obj, attr, image)
    obj.save(update_fields=[attr])


def month_bounds(day):
    return day.replace(day=1), day.replace(day=calendar.monthrange(day.year, day.month)[1])


def previous_month(day):
    first, _ = month_bounds(day)
    return month_bounds(first - timedelta(days=1))


def weeks_of_month(day):
    first, last = month_bounds(day)
    weeks, start = [], first
    while start <= last:
        end = min(start + timedelta(days=6 - start.weekday()), last)
        weeks.append((start, end))
        start = end + timedelta(days=1)
    return weeks


def can_see_sales(user):
    return user.is_owner or ShopSettings.get().employeesSeeSales


def can_see_cost(user):
    return user.is_owner or ShopSettings.get().employeesSeeCost


def index(request):
    return HttpResponse("Jewellery shop API")


# =========================================================================== auth
class LoginThrottle(ScopedRateThrottle):
    scope_attr = "throttle_scope"


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def login_view(request):
    data = s.LoginIn(data=request.data)
    data.is_valid(raise_exception=True)
    v = data.validated_data
    try:
        result = security.login(request, v["username"], v["password"], v.get("otp"), v.get("remember"))
    except security.LoginError as e:
        return Response({"detail": e.message, "code": e.code}, status=e.status)
    if result.get("otpRequired"):
        return Response({"otpRequired": True})
    user = security.find_user(v["username"])
    return Response({**result, "user": s.user_out(user, request)})


login_view.cls.throttle_scope = "login"


@api_view(["POST"])
@permission_classes([AllowAny])
def refresh_view(request):
    token = request.data.get("refresh") or ""
    try:
        rt = RefreshToken(token)
        user = User.objects.filter(pk=rt.get("user_id"), is_active=True).first()
        if user is None or rt.get("tv", 0) != user.tokenVersion:
            raise TokenError("revoked")
    except TokenError:
        return Response({"detail": "Session ended. Please sign in again.", "code": "token_not_valid"}, status=401)
    serializer = TokenRefreshSerializer(data={"refresh": token})
    try:
        serializer.is_valid(raise_exception=True)
    except Exception:  # noqa: BLE001
        return Response({"detail": "Session ended. Please sign in again.", "code": "token_not_valid"}, status=401)
    return Response(serializer.validated_data)


@api_view(["POST"])
def logout_view(request):
    token = request.data.get("refresh")
    if token:
        try:
            RefreshToken(token).blacklist()
        except Exception:  # noqa: BLE001
            pass
    return Response(status=status.HTTP_205_RESET_CONTENT)


@api_view(["GET", "PATCH", "POST"])
@parser_classes(ANY_PARSERS)
def me(request):
    user = request.user
    if request.method != "GET":
        serializer = s.ProfileIn(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        if request.FILES.get("profileImage") or request.data.get("remove") in ("1", "true"):
            set_photo(request, user, "profileImage", "profileImage")
    return Response(s.user_out(user, request))


@api_view(["POST"])
def change_password(request):
    serializer = s.ChangePasswordIn(data=request.data, context={"user": request.user})
    serializer.is_valid(raise_exception=True)
    user = request.user
    if not user.check_password(serializer.validated_data["old_password"]):
        return Response({"old_password": ["Wrong password."]}, status=400)
    user.set_password(serializer.validated_data["new_password"])
    user.tokenVersion += 1  # every other device is signed out
    user.save()
    services.log(user, "user.password", "user", user.id, user.username)
    return Response({"detail": "Password updated.", **security.tokens_for(user)})


@api_view(["POST"])
def twofa_setup(request):
    user = request.user
    user.totpSecret = pyotp.random_base32()
    user.save(update_fields=["totpSecret"])
    uri = pyotp.TOTP(user.totpSecret).provisioning_uri(name=user.email or user.username, issuer_name=ShopSettings.get().shopName)
    buf = io.BytesIO()
    qrcode.make(uri).save(buf, "PNG")
    return Response({"secret": user.totpSecret, "uri": uri, "qr": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()})


@api_view(["POST"])
def twofa_enable(request):
    user = request.user
    code = str(request.data.get("code") or "").replace(" ", "")
    if not user.totpSecret or not pyotp.TOTP(user.totpSecret).verify(code, valid_window=1):
        raise ValidationError({"code": "The 6-digit code is wrong."})
    user.totpEnabled = True
    user.save(update_fields=["totpEnabled"])
    services.log(user, "user.2fa_on", "user", user.id, user.username)
    return Response(s.user_out(user, request))


@api_view(["POST"])
def twofa_disable(request):
    user = request.user
    if not user.check_password(request.data.get("password") or ""):
        raise ValidationError({"password": "Wrong password."})
    user.totpEnabled, user.totpSecret = False, ""
    user.save(update_fields=["totpEnabled", "totpSecret"])
    services.log(user, "user.2fa_off", "user", user.id, user.username)
    return Response(s.user_out(user, request))


@api_view(["GET"])
def login_history(request):
    qs = LoginEvent.objects.select_related("user")
    if not (request.user.is_owner and param(request, "all") == "1"):
        qs = qs.filter(user=request.user)
    return paginate(request, qs, lambda e: {
        "id": e.id, "user": s.user_brief(e.user), "username": e.username, "ip": e.ip, "userAgent": e.userAgent,
        "success": e.success, "reason": e.reason, "at": e.at})


# =========================================================================== users (owner)
@api_view(["GET", "POST"])
@permission_classes([IsOwner])
def users(request):
    if request.method == "POST":
        serializer = s.UserIn(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        services.log(request.user, "user.create", "user", user.id, user.username)
        return Response(s.user_out(user, request), status=201)
    return Response([s.user_out(u, request) for u in User.objects.order_by("-is_active", "role", "username")])


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsOwner])
@parser_classes(ANY_PARSERS)
def user_detail(request, pk):
    user = get_object_or_404(User, pk=pk)
    owners = User.objects.filter(Q(role="owner") | Q(is_superuser=True), is_active=True)
    if request.method == "DELETE":
        if user == request.user:
            raise ValidationError({"user": "You cannot remove your own account."})
        user.is_active = False
        user.tokenVersion += 1
        user.save(update_fields=["is_active", "tokenVersion"])
        services.log(request.user, "user.deactivate", "user", user.id, user.username)
        return Response(s.user_out(user, request))
    if request.method == "PATCH":
        serializer = s.UserIn(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        demoting = serializer.validated_data.get("role") == "employee" or serializer.validated_data.get("is_active") is False
        if demoting and user.is_owner and owners.exclude(pk=user.pk).count() == 0:
            raise ValidationError({"role": "The shop needs at least one active owner."})
        if user.is_superuser and serializer.validated_data.get("role") == "employee":
            user.is_superuser = False
        serializer.save()
        if request.FILES.get("profileImage") or request.data.get("remove") in ("1", "true"):
            set_photo(request, user, "profileImage", "profileImage")
        services.log(request.user, "user.update", "user", user.id, user.username)
    return Response(s.user_out(user, request))


@api_view(["POST"])
@permission_classes([IsOwner])
def user_signout(request, pk):
    user = get_object_or_404(User, pk=pk)
    security.sign_out_everywhere(user)
    services.log(request.user, "user.signout", "user", user.id, user.username)
    return Response({"detail": "Signed out on every device."})


@api_view(["POST"])
@permission_classes([IsOwner])
def user_unlock(request, pk):
    user = get_object_or_404(User, pk=pk)
    user.lockedUntil, user.failedLogins = None, 0
    user.save(update_fields=["lockedUntil", "failedLogins"])
    return Response(s.user_out(user, request))


# =========================================================================== shop settings, metals, rates
@api_view(["GET", "PATCH"])
@permission_classes([OwnerForWrites])
def shop_view(request):
    shop = ShopSettings.get()
    if request.method == "PATCH":
        serializer = s.ShopIn(shop, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        services.log(request.user, "shop.update", "shop", 1, shop.shopName)
    return Response(s.shop_out(shop, request))


@api_view(["POST"])
@permission_classes([IsOwner])
@parser_classes([MultiPartParser, FormParser])
def shop_logo(request):
    shop = ShopSettings.get()
    set_photo(request, shop, "logo", "logo")
    return Response(s.shop_out(shop, request))


@api_view(["GET", "POST"])
@permission_classes([OwnerForWrites])
def grades(request):
    if request.method == "POST":
        serializer = s.GradeIn(data=request.data)
        serializer.is_valid(raise_exception=True)
        g = serializer.save()
        return Response(s.grade_out(g), status=201)
    return Response([s.grade_out(g) for g in MetalGrade.objects.all()])


@api_view(["PATCH", "DELETE"])
@permission_classes([IsOwner])
def grade_detail(request, pk):
    g = get_object_or_404(MetalGrade, pk=pk)
    if request.method == "DELETE":
        used = g.stock.exists() or Bill.objects.filter(grade=g).exists() or Order.objects.filter(grade=g).exists()
        if used:
            g.isActive = False
            g.save(update_fields=["isActive"])
            return Response(s.grade_out(g))
        g.delete()
        return Response(status=204)
    serializer = s.GradeIn(g, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(s.grade_out(g))


def _today_rates():
    today = localdate()
    out = []
    for g in MetalGrade.objects.filter(isActive=True):
        r = Rate.objects.filter(grade=g).order_by("-date").first()
        out.append({**s.grade_out(g), "rate": s.rate_out(r) if r else None, "isToday": bool(r and r.date == today)})
    return out


@api_view(["GET"])
def rates_today(request):
    rows = _today_rates()
    return Response({"grades": rows, "allToday": bool(rows) and all(r["isToday"] for r in rows)})


@api_view(["POST"])
def rates_set(request):
    if not request.user.is_owner and not ShopSettings.get().employeesCanSetRates:
        raise PermissionDenied("Only the owner can set the rates.")
    serializer = s.RatesIn(data=request.data)
    serializer.is_valid(raise_exception=True)
    day = serializer.validated_data.get("date") or localdate()
    for row in serializer.validated_data["rates"]:
        g = services.grade_or_none(row["grade"])
        Rate.objects.update_or_create(date=day, grade=g, defaults={"sellPrice": row["sellPrice"], "buyPrice": row.get("buyPrice"), "setBy": request.user})
    services.log(request.user, "rates.set", "rate", None, str(day))
    rows = _today_rates()
    return Response({"grades": rows, "allToday": all(r["isToday"] for r in rows)})


@api_view(["GET"])
def rates_history(request):
    qs = Rate.objects.select_related("grade").order_by("-date", "grade__sortOrder")
    grade = param(request, "grade")
    if grade.isdigit():
        qs = qs.filter(grade_id=int(grade))
    limit = min(int(param(request, "limit", "300") or 300), 2000)
    return Response([s.rate_out(r) for r in qs[:limit]])


@api_view(["GET"])
def rates_report(request):
    """Chart data: one row per day (weekly / monthly) or per month (yearly), one key per grade id."""
    kind = param(request, "type", "monthly")
    today = localdate()
    if kind == "weekly":
        start = today - timedelta(days=6)
    elif kind == "monthly":
        start = today - timedelta(days=29)
    elif kind == "yearly":
        start = today.replace(month=1, day=1)
    else:
        raise ValidationError({"type": "Use weekly, monthly or yearly."})
    rates = Rate.objects.filter(date__gte=start, date__lte=today).order_by("date")
    rows = {}
    for r in rates:
        key = r.date.strftime("%Y-%m") if kind == "yearly" else r.date.isoformat()
        rows.setdefault(key, {}).setdefault(str(r.grade_id), []).append(r.sellPrice)
    return Response([{"label": k, **{g: round(sum(v) / len(v), 2) for g, v in vals.items()}} for k, vals in rows.items()])


# =========================================================================== dashboard & reports
def _month_counts(model):
    today = localdate()
    first, last = month_bounds(today)
    pf, pl = previous_month(today)
    cur = model.objects.filter(date__range=[first, last]).count()
    prev = model.objects.filter(date__range=[pf, pl]).count()
    return {"total": cur, "previous": prev, "change": round((cur - prev) / prev * 100) if prev else None}


@api_view(["GET"])
def dashboard(request):
    today = localdate()
    first, last = month_bounds(today)
    open_st = ["pending", "inprogress", "completed"]
    submitted = Bill.objects.filter(status="submitted")
    attention = (Order.objects.filter(status__in=open_st, dueDate__lte=today + timedelta(days=7))
                 .select_related("customer", "grade", "createdBy").prefetch_related("items", "bills").order_by("dueDate")[:6])
    recent = Bill.objects.select_related("customer", "createdBy").prefetch_related("lines").order_by("-createdAt")[:6]
    stock = StockItem.objects.filter(status="instock")
    data = {
        "rates": _today_rates(),
        "counts": {
            "customers": Customer.objects.count(),
            "pending": Order.objects.filter(status="pending").count(),
            "inprogress": Order.objects.filter(status="inprogress").count(),
            "ready": Order.objects.filter(status="completed").count(),
            "overdue": Order.objects.filter(status__in=open_st, dueDate__lt=today).count(),
            "dueBills": submitted.filter(remainingAmount__gt=0.005).count(),
            "stockPieces": stock.count(),
            "stockWeight": round(stock.aggregate(w=Sum("weight"))["w"] or 0, 2),
            "workOut": StaffWork.objects.filter(status="inprogress").count(),
            "lateWork": StaffWork.objects.filter(status="inprogress", dueDate__lt=today).count(),
        },
        "attention": [s.order_summary(o) for o in attention],
        "recentBills": [s.bill_summary(b) for b in recent],
        "showMoney": can_see_sales(request.user),
    }
    if data["showMoney"]:
        def total(qs):
            return round(qs.aggregate(t=Sum("grandTotal"))["t"] or 0, 2)

        cash_today = (submitted.filter(date=today).aggregate(t=Sum("paidAmount"))["t"] or 0) + \
                     (BillPayment.objects.filter(date=today).aggregate(t=Sum("amount"))["t"] or 0)
        data["money"] = {
            "today": total(submitted.filter(date=today)),
            "month": total(submitted.filter(date__range=[first, last])),
            "due": round(submitted.filter(remainingAmount__gt=0.005).aggregate(t=Sum("remainingAmount"))["t"] or 0, 2),
            "cashToday": round(cash_today, 2),
            "soldWeightMonth": round(submitted.filter(date__range=[first, last]).aggregate(w=Sum("finalWeight"))["w"] or 0, 2),
        }
        if request.user.is_owner:
            owed = sum(services.supplier_balance(x) for x in Supplier.objects.all())
            data["money"]["owedToSuppliers"] = round(owed, 2)
        data["increment"] = {"bill": _month_counts(Bill), "order": _month_counts(Order)}
    return Response(data)


@api_view(["GET"])
def sales_report(request):
    if not can_see_sales(request.user):
        raise PermissionDenied("Only the owner can see sales figures.")
    day = parse_date(param(request, "date")) or localdate()
    today = localdate()
    weeks = []
    for i, (start, end) in enumerate(weeks_of_month(day), start=1):
        if start > today:
            break
        bills = Bill.objects.filter(status="submitted", date__range=[start, end])
        total = sum(b.grandTotal for b in bills)
        due = sum(max(b.remainingAmount, 0) for b in bills)
        weeks.append({"label": f"{start:%d/%m}–{end:%d/%m}", "week": i, "start": start, "end": end,
                      "total": round(total, 2), "paid": round(total - due, 2), "due": round(due, 2)})
    return Response({"monthDate": day.replace(day=1), "weeks": weeks})


@api_view(["GET"])
def items_report(request):
    day = parse_date(param(request, "date")) or localdate()
    first, last = month_bounds(day)
    names = Bill.objects.filter(status="submitted", date__range=[first, last]).values_list("lines__name", flat=True)
    counts = Counter(n.strip().title() for n in names if n)
    return Response({"monthDate": first, "items": [{"name": n, "count": c} for n, c in counts.most_common(8)]})


# =========================================================================== customers
def _customer_row(c, due_map):
    data = s.customer_brief(c)
    data.update({"orderCount": getattr(c, "orderCount", 0), "billCount": getattr(c, "billCount", 0),
                 "dueAmount": round(due_map.get(c.customerId, 0) or 0, 2)})
    return data


@api_view(["GET", "POST"])
def customers(request):
    if request.method == "POST":
        serializer = s.CustomerIn(data=request.data)
        serializer.is_valid(raise_exception=True)
        c = serializer.save()
        services.log(request.user, "customer.create", "customer", c.customerId, c.name)
        return Response(s.customer_brief(c), status=201)
    q = param(request, "q")
    qs = Customer.objects.annotate(orderCount=Count("orders", distinct=True), billCount=Count("bills", distinct=True))
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(address__icontains=q) | Q(phone__icontains=q))
    if param(request, "owing") == "1":
        qs = qs.filter(bills__status="submitted", bills__remainingAmount__gt=0.005).distinct()
    qs = qs.order_by("name")
    due_map = {r["customer"]: r["t"] for r in Bill.objects.filter(status="submitted", remainingAmount__gt=0)
               .values("customer").annotate(t=Sum("remainingAmount"))}
    if param(request, "all") == "1":
        return Response([_customer_row(c, due_map) for c in qs[:50]])
    return paginate(request, qs, lambda c: _customer_row(c, due_map))


@api_view(["GET", "PATCH", "DELETE"])
def customer_detail(request, pk):
    c = get_object_or_404(Customer, pk=pk)
    if request.method == "PATCH":
        serializer = s.CustomerIn(c, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        services.log(request.user, "customer.update", "customer", c.customerId, c.name)
        return Response(s.customer_brief(c))
    if request.method == "DELETE":
        services.require_owner(request.user)
        if c.orders.exists() or c.bills.exists():
            raise ValidationError({"customer": "This customer has orders or bills, so it cannot be deleted."})
        services.log(request.user, "customer.delete", "customer", c.customerId, c.name)
        c.delete()
        return Response(status=204)
    orders = c.orders.select_related("customer", "grade", "createdBy").prefetch_related("items", "bills").order_by("-date", "-orderId")
    bills = c.bills.select_related("customer", "createdBy").prefetch_related("lines").order_by("-date", "-billId")
    data = s.customer_brief(c)
    data["orders"] = [s.order_summary(o) for o in orders]
    data["bills"] = [s.bill_summary(b) for b in bills]
    data["dueAmount"] = round(sum(b.remainingAmount for b in bills if b.status == "submitted" and b.remainingAmount > 0), 2)
    return Response(data)


# =========================================================================== suppliers (owner)
@api_view(["GET", "POST"])
@permission_classes([IsOwner])
def suppliers(request):
    if request.method == "POST":
        serializer = s.SupplierIn(data=request.data)
        serializer.is_valid(raise_exception=True)
        sup = serializer.save()
        services.log(request.user, "supplier.create", "supplier", sup.supplierId, sup.name)
        return Response(s.supplier_out(sup, request, 0), status=201)
    qs = Supplier.objects.all().order_by("-isActive", "name")
    q = param(request, "q")
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(company__icontains=q) | Q(phone__icontains=q))
    return Response([s.supplier_out(x, request, services.supplier_balance(x)) for x in qs])


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsOwner])
def supplier_detail(request, pk):
    sup = get_object_or_404(Supplier, pk=pk)
    if request.method == "DELETE":
        if sup.purchases.exists() or sup.payments.exists():
            sup.isActive = False
            sup.save(update_fields=["isActive"])
            return Response(s.supplier_out(sup, request, services.supplier_balance(sup)))
        sup.delete()
        return Response(status=204)
    if request.method == "PATCH":
        serializer = s.SupplierIn(sup, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
    data = s.supplier_out(sup, request, services.supplier_balance(sup))
    purchases = sup.purchases.select_related("supplier", "createdBy").prefetch_related("lines", "payments").order_by("-date", "-purchaseId")
    data["purchases"] = [s.purchase_out(p) for p in purchases]
    data["payments"] = [s.supplier_payment_out(p) for p in sup.payments.select_related("createdBy").order_by("-date", "-paymentId")]
    data["totalBought"] = round(sum(p.totalAmount for p in purchases), 2)
    data["totalWeight"] = round(sum(p.totalWeight for p in purchases), 3)
    data["stockCount"] = sup.stock.filter(status="instock").count()
    return Response(data)


@api_view(["POST"])
@permission_classes([IsOwner])
@parser_classes([MultiPartParser, FormParser])
def supplier_photo(request, pk):
    sup = get_object_or_404(Supplier, pk=pk)
    set_photo(request, sup, "photo", "photo")
    return Response(s.supplier_out(sup, request, services.supplier_balance(sup)))


@api_view(["GET", "POST"])
@permission_classes([IsOwner])
def purchases(request):
    if request.method == "POST":
        serializer = s.PurchaseIn(data=request.data)
        serializer.is_valid(raise_exception=True)
        p = services.save_purchase(serializer.validated_data, request.user)
        p = Purchase.objects.select_related("supplier").prefetch_related("lines", "payments").get(pk=p.pk)
        return Response(s.purchase_out(p, detail=True), status=201)
    qs = Purchase.objects.select_related("supplier", "createdBy").prefetch_related("lines", "payments").order_by("-date", "-purchaseId")
    sup = param(request, "supplier")
    if sup.isdigit():
        qs = qs.filter(supplier_id=int(sup))
    return paginate(request, qs, s.purchase_out)


@api_view(["GET", "DELETE"])
@permission_classes([IsOwner])
def purchase_detail(request, pk):
    p = get_object_or_404(Purchase.objects.select_related("supplier").prefetch_related("lines", "payments"), pk=pk)
    if request.method == "DELETE":
        if p.payments.exists():
            raise ValidationError({"purchase": "Delete the payments for this purchase first."})
        services.log(request.user, "purchase.delete", "supplier", p.supplier_id, f"{p.supplier.name} {p.totalAmount:.2f}")
        p.delete()
        return Response(status=204)
    return Response(s.purchase_out(p, detail=True))


@api_view(["POST"])
@permission_classes([IsOwner])
def supplier_payments(request):
    serializer = s.SupplierPaymentIn(data=request.data)
    serializer.is_valid(raise_exception=True)
    p = services.add_supplier_payment(serializer.validated_data, request.user)
    return Response(s.supplier_payment_out(p), status=201)


@api_view(["DELETE"])
@permission_classes([IsOwner])
def supplier_payment_detail(request, pk):
    p = get_object_or_404(SupplierPayment, pk=pk)
    services.log(request.user, "supplier.payment_delete", "supplier", p.supplier_id, f"{p.amount:.2f}")
    p.delete()
    return Response(status=204)


# =========================================================================== catalog & stock
@api_view(["GET", "POST"])
def catalog(request):
    if request.method == "POST":
        serializer = s.CatalogIn(data=request.data)
        serializer.is_valid(raise_exception=True)
        c = serializer.save()
        return Response(s.catalog_out(c, request), status=201)
    qs = CatalogProduct.objects.annotate(inStock=Count("stock", filter=Q(stock__status="instock")))
    q = param(request, "q")
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(category__icontains=q) | Q(gemsName__icontains=q))
    active = param(request, "active")
    if active in ("0", "1"):
        qs = qs.filter(isActive=active == "1")
    if param(request, "all") == "1":
        return Response([s.catalog_out(c, request) for c in qs[:500]])
    return paginate(request, qs, lambda c: s.catalog_out(c, request), 24)


@api_view(["GET", "PATCH", "DELETE"])
def catalog_detail(request, pk):
    c = get_object_or_404(CatalogProduct, pk=pk)
    if request.method == "DELETE":
        services.require_owner(request.user)
        if c.image:
            c.image.delete(save=False)
        c.delete()
        return Response(status=204)
    if request.method == "PATCH":
        serializer = s.CatalogIn(c, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
    return Response(s.catalog_out(c, request))


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def catalog_image(request, pk):
    c = get_object_or_404(CatalogProduct, pk=pk)
    set_photo(request, c, "image", "image")
    return Response(s.catalog_out(c, request))


def _stock_qs():
    return StockItem.objects.select_related("grade", "supplier", "billLine")


@api_view(["GET", "POST"])
def stock(request):
    show_cost = can_see_cost(request.user)
    if request.method == "POST":
        serializer = s.StockIn(data=request.data)
        serializer.is_valid(raise_exception=True)
        items = services.create_stock(dict(serializer.validated_data), request.user)
        return Response([s.stock_out(i, request, show_cost) for i in items], status=201)
    qs = _stock_qs()
    q = param(request, "q")
    if q:
        qs = qs.filter(Q(code__iexact=q) | Q(name__icontains=q) | Q(category__icontains=q) | Q(gemsName__icontains=q) | Q(code__icontains=q))
    st = param(request, "status", "instock")
    if st != "all":
        qs = qs.filter(status=st)
    g = param(request, "grade")
    if g.isdigit():
        qs = qs.filter(grade_id=int(g))
    cat = param(request, "category")
    if cat:
        qs = qs.filter(category__iexact=cat)
    sup = param(request, "supplier")
    if sup.isdigit():
        qs = qs.filter(supplier_id=int(sup))
    qs = qs.order_by("-createdAt", "-itemId")
    totals = qs.aggregate(n=Count("itemId"), w=Sum("weight"))
    response = paginate(request, qs, lambda i: s.stock_out(i, request, show_cost), int(param(request, "page_size", "24") or 24))
    response.data["totalWeight"] = round(totals["w"] or 0, 3)
    return response


@api_view(["GET"])
def stock_categories(request):
    cats = set(StockItem.objects.exclude(category="").values_list("category", flat=True))
    cats |= set(CatalogProduct.objects.exclude(category="").values_list("category", flat=True))
    return Response(sorted(cats, key=str.lower))


@api_view(["GET"])
def stock_by_code(request, code):
    item = _stock_qs().filter(code__iexact=code.strip()).first()
    if item is None:
        return Response({"detail": "No piece has this code."}, status=404)
    return Response(s.stock_out(item, request, can_see_cost(request.user)))


@api_view(["GET", "PATCH", "DELETE"])
def stock_detail(request, pk):
    item = get_object_or_404(_stock_qs(), pk=pk)
    show_cost = can_see_cost(request.user)
    if request.method == "DELETE":
        services.require_owner(request.user)
        if item.status != "instock":
            raise ValidationError({"stock": "A piece that is on a bill cannot be deleted."})
        if item.photo:
            item.photo.delete(save=False)
        services.log(request.user, "stock.delete", "stock", item.itemId, f"{item.code} {item.name}")
        item.delete()
        return Response(status=204)
    if request.method == "PATCH":
        serializer = s.StockIn(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.check_version(item, serializer.validated_data.pop("version", None))
        serializer.validated_data.pop("quantity", None)
        if "costPrice" in serializer.validated_data and not show_cost:
            serializer.validated_data.pop("costPrice")
        if not serializer.validated_data.get("code", "x"):
            serializer.validated_data.pop("code")
        item.version += 1
        serializer.save()
        services.log(request.user, "stock.update", "stock", item.itemId, f"{item.code} {item.name}")
    return Response(s.stock_out(item, request, show_cost))


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def stock_photo(request, pk):
    item = get_object_or_404(_stock_qs(), pk=pk)
    set_photo(request, item, "photo", "photo")
    return Response(s.stock_out(item, request, can_see_cost(request.user)))


# =========================================================================== orders
ORDER_RELATED = ("items__works__staff", "bills")


def _order_response(order, request, code=200):
    order = Order.objects.select_related("customer", "grade", "createdBy").prefetch_related(*ORDER_RELATED).get(pk=order.pk)
    return Response(s.order_detail(order, request), status=code)


@api_view(["GET", "POST"])
def orders(request):
    if request.method == "POST":
        serializer = s.OrderPayload(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = services.save_order(serializer.validated_data, request.user)
        return _order_response(order, request, 201)
    qs = Order.objects.select_related("customer", "grade", "createdBy").prefetch_related("items", "bills")
    today = localdate()
    q = param(request, "q")
    if q:
        cond = Q(customer__name__icontains=q) | Q(customer__phone__icontains=q) | Q(customer__address__icontains=q)
        if q.lstrip("#").isdigit():
            cond |= Q(orderId=int(q.lstrip("#")))
        qs = qs.filter(cond)
    st = param(request, "status", "all")
    open_st = ["pending", "inprogress", "completed"]
    if st == "active":
        qs = qs.filter(status__in=open_st)
    elif st != "all":
        qs = qs.filter(status=st)
    due = param(request, "due")
    if due == "overdue":
        qs = qs.filter(status__in=open_st, dueDate__lt=today)
    elif due == "today":
        qs = qs.filter(status__in=open_st, dueDate=today)
    elif due == "week":
        qs = qs.filter(status__in=open_st, dueDate__gte=today, dueDate__lte=today + timedelta(days=7))
    ordering = ("dueDate", "-orderId") if due or st in ("active", "pending", "inprogress", "completed") else ("-date", "-orderId")
    return paginate(request, qs.order_by(*ordering), s.order_summary)


@api_view(["GET", "PUT", "DELETE"])
def order_detail(request, pk):
    order = get_object_or_404(Order, pk=pk)
    if request.method == "PUT":
        serializer = s.OrderPayload(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.save_order(serializer.validated_data, request.user, order=order)
    elif request.method == "DELETE":
        services.delete_order(order, request.user)
        return Response(status=204)
    return _order_response(order, request)


@api_view(["POST"])
def order_status(request, pk):
    order = get_object_or_404(Order, pk=pk)
    serializer = s.StatusIn(data=request.data)
    serializer.is_valid(raise_exception=True)
    services.set_order_status(order, serializer.validated_data["status"], request.user)
    return _order_response(order, request)


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def order_item_design(request, pk):
    it = get_object_or_404(OrderItem, pk=pk)
    set_photo(request, it, "design", "design")
    return Response({"orderItemId": it.orderItemId, "design": s.file_url(request, it.design)})


# =========================================================================== bills
def _bill_response(bill, request, code=200):
    bill = (Bill.objects.select_related("customer", "createdBy")
            .prefetch_related("lines__grade", "lines__stockItem", "payments__createdBy").get(pk=bill.pk))
    return Response(s.bill_detail(bill, request), status=code)


@api_view(["GET", "POST"])
def bills(request):
    if request.method == "POST":
        serializer = s.BillPayload(data=request.data)
        serializer.is_valid(raise_exception=True)
        bill = services.save_bill(serializer.validated_data, request.user)
        return _bill_response(bill, request, 201)
    qs = Bill.objects.select_related("customer", "createdBy").prefetch_related("lines")
    q = param(request, "q")
    if q:
        cond = Q(customer__name__icontains=q) | Q(customer__phone__icontains=q) | Q(lines__name__icontains=q) | Q(lines__stockItem__code__iexact=q)
        if q.lstrip("#").isdigit():
            cond |= Q(billId=int(q.lstrip("#")))
        qs = qs.filter(cond).distinct()
    st = param(request, "status", "all")
    if st != "all":
        qs = qs.filter(status=st)
    pay = param(request, "payment", "all")
    if pay == "due":
        qs = qs.filter(remainingAmount__gt=0.005)
    elif pay == "paid":
        qs = qs.filter(remainingAmount__lte=0.005)
    d1, d2 = parse_date(param(request, "date_from"), "date_from"), parse_date(param(request, "date_to"), "date_to")
    if d1:
        qs = qs.filter(date__gte=d1)
    if d2:
        qs = qs.filter(date__lte=d2)
    return paginate(request, qs.order_by("-date", "-billId"), s.bill_summary)


@api_view(["GET", "PUT", "DELETE"])
def bill_detail(request, pk):
    bill = get_object_or_404(Bill, pk=pk)
    if request.method == "PUT":
        serializer = s.BillPayload(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.save_bill(serializer.validated_data, request.user, bill=bill)
    elif request.method == "DELETE":
        services.delete_bill(bill, request.user)
        return Response(status=204)
    return _bill_response(bill, request)


@api_view(["POST"])
def bill_payments(request, pk):
    bill = get_object_or_404(Bill, pk=pk)
    serializer = s.PaymentIn(data=request.data)
    serializer.is_valid(raise_exception=True)
    services.add_bill_payment(bill, serializer.validated_data, request.user)
    return _bill_response(bill, request)


@api_view(["DELETE"])
def bill_payment_detail(request, pk):
    p = get_object_or_404(BillPayment, pk=pk)
    bill = services.delete_bill_payment(p, request.user)
    return _bill_response(bill, request)


# =========================================================================== craftsmen
def _staff_qs():
    return Staff.objects.prefetch_related("works")


@api_view(["GET", "POST"])
def staff(request):
    if request.method == "POST":
        serializer = s.StaffIn(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data.get("phone")
        if phone and Staff.objects.filter(phone=phone).exists():
            raise ValidationError({"phone": "A craftsman with this phone is already registered."})
        st = serializer.save()
        services.log(request.user, "staff.create", "staff", st.staffId, st.staffName)
        return Response(s.staff_out(_staff_qs().get(pk=st.pk), request), status=201)
    qs = _staff_qs().order_by("resignDate", "staffName")
    if param(request, "active") == "1":
        qs = qs.filter(resignDate__isnull=True)
    q = param(request, "q")
    if q:
        qs = qs.filter(Q(staffName__icontains=q) | Q(phone__icontains=q))
    return Response([s.staff_out(x, request) for x in qs])


@api_view(["GET", "PATCH", "DELETE"])
def staff_detail(request, pk):
    st = get_object_or_404(_staff_qs(), pk=pk)
    if request.method == "DELETE":
        services.require_owner(request.user)
        if st.works.exists():
            raise ValidationError({"staff": f"{st.staffName} has work history. Set a leaving date instead of deleting."})
        st.delete()
        return Response(status=204)
    if request.method == "PATCH":
        serializer = s.StaffIn(st, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data.get("phone")
        if phone and Staff.objects.filter(phone=phone).exclude(pk=pk).exists():
            raise ValidationError({"phone": "A craftsman with this phone is already registered."})
        serializer.save()
        st = _staff_qs().get(pk=pk)
    data = s.staff_out(st, request)
    works = StaffWork.objects.filter(staff=st).select_related("staff", "orderItem__order__grade").order_by("-date", "-staffWorkId")
    data["works"] = [s.work_out(w) for w in works]
    return Response(data)


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def staff_photo(request, pk):
    st = get_object_or_404(_staff_qs(), pk=pk)
    set_photo(request, st, "photo", "photo")
    return Response(s.staff_out(st, request))


def _work_qs():
    return StaffWork.objects.select_related("staff", "orderItem__order__grade")


@api_view(["GET", "POST"])
def work(request):
    if request.method == "POST":
        serializer = s.WorkIn(data=request.data)
        serializer.is_valid(raise_exception=True)
        w = services.give_work(serializer.validated_data, request.user)
        return Response(s.work_out(_work_qs().get(pk=w.pk)), status=201)
    qs = _work_qs()
    q = param(request, "q")
    if q:
        qs = qs.filter(Q(staff__staffName__icontains=q) | Q(orderItem__name__icontains=q))
    st = param(request, "status", "all")
    if st != "all":
        qs = qs.filter(status=st)
    if param(request, "due") == "overdue":
        qs = qs.filter(status="inprogress", dueDate__lt=localdate())
    sid = param(request, "staff")
    if sid.isdigit():
        qs = qs.filter(staff_id=int(sid))
    return paginate(request, qs.order_by("-date", "-staffWorkId"), s.work_out)


@api_view(["PATCH", "DELETE"])
def work_detail(request, pk):
    w = get_object_or_404(StaffWork, pk=pk)
    if request.method == "DELETE":
        services.delete_work(w, request.user)
        return Response(status=204)
    serializer = s.WorkIn(data=request.data)
    serializer.is_valid(raise_exception=True)
    services.edit_work(w, serializer.validated_data, request.user)
    return Response(s.work_out(_work_qs().get(pk=pk)))


@api_view(["POST"])
def work_receive(request, pk):
    w = get_object_or_404(StaffWork, pk=pk)
    serializer = s.WorkReturnIn(data=request.data)
    serializer.is_valid(raise_exception=True)
    services.receive_work(w, serializer.validated_data, request.user)
    return Response(s.work_out(_work_qs().get(pk=pk)))


@api_view(["GET"])
def order_pending_items(request, pk):
    order = get_object_or_404(Order.objects.select_related("customer"), pk=pk)
    items = order.items.filter(status="pending").prefetch_related("works__staff")
    return Response({"orderId": order.orderId, "customer": s.customer_brief(order.customer), "dueDate": order.dueDate,
                     "items": [s.order_item_out(it, request) for it in items]})


# =========================================================================== activity & backup
@api_view(["GET"])
@permission_classes([IsOwner])
def activity(request):
    qs = Activity.objects.select_related("user")
    uid = param(request, "user")
    if uid.isdigit():
        qs = qs.filter(user_id=int(uid))
    return paginate(request, qs, s.activity_out, 50)


@api_view(["GET"])
def activity_latest(request):
    """Cheap poll so every open screen knows when a colleague changed something."""
    a = Activity.objects.select_related("user").first()
    return Response({"id": a.id if a else 0, "user": s.user_brief(a.user) if a else None, "action": a.action if a else None})


@api_view(["GET"])
@permission_classes([IsOwner])
def backup(request):
    out = io.StringIO()
    management.call_command("dumpdata", "main", "--natural-foreign", "--indent", "1",
                            "--exclude", "main.loginevent", stdout=out)
    services.log(request.user, "backup.download")
    resp = HttpResponse(out.getvalue(), content_type="application/json")
    resp["Content-Disposition"] = f'attachment; filename="backup-{timezone.localtime():%Y-%m-%d-%H%M}.json"'
    return resp
