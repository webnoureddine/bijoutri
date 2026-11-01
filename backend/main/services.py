"""Business rules. Views stay thin; everything that changes several tables runs here inside a transaction,
with row locks where two people could change the same thing at once (selling the same piece, paying the
same bill, giving the same item to two craftsmen)."""
import logging

from django.db import transaction
from django.db.models import Max, Sum
from django.utils.timezone import localdate
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from . import calc
from .models import (Activity, Bill, BillLine, BillPayment, Customer, MetalGrade, Order, OrderItem, Purchase,
                     PurchaseLine, Rate, ShopSettings, Staff, StaffWork, StockItem, Supplier, SupplierPayment)

logger = logging.getLogger(__name__)


class Conflict(APIException):
    status_code = 409
    default_detail = "Someone else changed this while you were editing. Reload the page to see their changes."
    default_code = "conflict"


# --------------------------------------------------------------------------- helpers
def log(user, action, obj_type="", obj_id=None, label=""):
    Activity.objects.create(user=user if user and user.is_authenticated else None, action=action,
                            objectType=obj_type, objectId=obj_id, label=label[:200])


def check_version(obj, version):
    if version is not None and int(version) != obj.version:
        raise Conflict()


def bump(obj):
    obj.version += 1


def grade_or_none(grade_id, field="grade"):
    if not grade_id:
        return None
    g = MetalGrade.objects.filter(pk=grade_id).first()
    if g is None:
        raise ValidationError({field: "Unknown metal."})
    return g


def latest_rate(grade):
    if grade is None:
        return None
    return Rate.objects.filter(grade=grade).order_by("-date").first()


def next_stock_code():
    prefix = ShopSettings.get().stockCodePrefix or "B"
    last = StockItem.objects.aggregate(m=Max("itemId"))["m"] or 0
    n = last + 1
    while True:
        code = f"{prefix}{n:06d}"
        if not StockItem.objects.filter(code=code).exists():
            return code
        n += 1


def require_owner(user, message="Only the owner can do this."):
    if not user.is_owner:
        raise PermissionDenied(message)


# --------------------------------------------------------------------------- customers
def resolve_customer(data):
    """Find or create the customer for an order/bill.

    * customerId given -> that customer (contact fields that were sent are updated)
    * else phone matches an existing customer -> reuse them, but only if the name matches too;
      a different name with the same phone is an error, never a silent rename
    * else a new customer (a name is required)
    """
    data = data or {}
    name = (data.get("name") or "").strip()
    phone = (data.get("phone") or "").strip() or None
    customer = None
    if data.get("customerId"):
        customer = Customer.objects.filter(pk=data["customerId"]).first()
        if customer is None:
            raise ValidationError({"customer": "Customer not found."})
        if phone:
            clash = Customer.objects.filter(phone=phone).exclude(pk=customer.pk).first()
            if clash:
                raise ValidationError({"customer": f"This phone already belongs to {clash.name}."})
    elif phone:
        match = Customer.objects.filter(phone=phone).first()
        if match:
            if name and name.lower() != match.name.lower():
                raise ValidationError({"customer": f"This phone already belongs to {match.name}. Pick them from the list or check the number."})
            customer = match

    if customer is None:
        if not name:
            raise ValidationError({"customer": "Customer name is required."})
        customer = Customer(name=name)
    elif name and data.get("customerId"):
        customer.name = name
    if data.get("address") is not None and data.get("address").strip():
        customer.address = data["address"].strip()
    if phone:
        customer.phone = phone
    if (data.get("email") or "").strip():
        customer.email = data["email"].strip()
    customer.save()
    return customer


# --------------------------------------------------------------------------- orders
def derived_status(order):
    statuses = [it.status for it in order.items.all()]
    if statuses and all(s == "completed" for s in statuses):
        return "completed"
    if any(s in ("inprogress", "completed") for s in statuses):
        return "inprogress"
    return "pending"


def recompute_order_status(order):
    if order.status == "submitted":
        return order.status
    new = derived_status(order)
    if new != order.status:
        order.status = new
        order.save(update_fields=["status", "updatedAt"])
    return new


def _sync_order_items(order, items):
    existing = {it.orderItemId: it for it in order.items.all()}
    keep = set()
    for data in items:
        it_id = data.get("orderItemId")
        if it_id:
            it = existing.get(it_id)
            if it is None:
                raise ValidationError({"items": f"Item {it_id} does not belong to this order."})
        else:
            it = OrderItem(order=order)
        it.name = data["name"].strip()
        it.netWeight = data.get("netWeight")
        it.size = (data.get("size") or "").strip()
        it.gemsName = (data.get("gemsName") or "").strip()
        it.gemsPrice = data.get("gemsPrice")
        it.quantity = data.get("quantity") or 1
        it.save()
        keep.add(it.orderItemId)
    for it_id, it in existing.items():
        if it_id in keep:
            continue
        if it.status != "pending":
            raise ValidationError({"items": "An item that is already with a craftsman cannot be removed."})
        it.delete()


@transaction.atomic
def save_order(payload, user, order=None):
    data = payload["order"]
    if order is not None:
        order = Order.objects.select_for_update().get(pk=order.pk)
        check_version(order, payload.get("version"))
        if order.status == "submitted":
            raise ValidationError({"order": "A delivered order can no longer be edited."})
    customer_data = dict(payload["customer"])
    if order is not None and not customer_data.get("customerId"):
        customer_data["customerId"] = order.customer_id
    customer = resolve_customer(customer_data)

    creating = order is None
    if creating:
        order = Order(createdBy=user)
    else:
        bump(order)
    order.customer = customer
    order.date = data.get("date") or order.date or localdate()
    order.grade = grade_or_none(data.get("grade"))
    order.rate = data.get("rate")
    order.advanceAmount = data.get("advanceAmount")
    order.dueDate = data["dueDate"]
    order.customerMetalWeight = data.get("customerMetalWeight")
    order.remark = (data.get("remark") or "").strip()
    order.save()
    _sync_order_items(order, payload["items"])
    recompute_order_status(order)
    log(user, "order.create" if creating else "order.update", "order", order.orderId, f"#{order.orderId} {customer.name}")
    return order


@transaction.atomic
def set_order_status(order, status, user):
    """Only 'delivered' (submitted) can be set by hand; the other states follow the items."""
    order = Order.objects.select_for_update().get(pk=order.pk)
    if status == "submitted":
        if order.status == "submitted":
            return order
        order.status, order.deliveredDate = "submitted", localdate()
    else:
        if order.bills.filter(status="submitted").exists():
            raise ValidationError({"order": "This order has a bill. Delete the bill to reopen the order."})
        derived = derived_status(order)
        if status != derived:
            raise ValidationError({"status": "This status follows the items. Give or receive work to change it."})
        order.status, order.deliveredDate = derived, None
    bump(order)
    order.save()
    log(user, "order.status", "order", order.orderId, f"#{order.orderId} → {order.status}")
    return order


@transaction.atomic
def delete_order(order, user):
    require_owner(user)
    if order.status != "pending":
        raise ValidationError({"order": "Only a new order can be deleted (work has already started)."})
    if order.bills.exists():
        raise ValidationError({"order": "This order has a bill. Delete the bill first."})
    log(user, "order.delete", "order", order.orderId, f"#{order.orderId}")
    order.delete()


def send_order_ready_email(order):
    from django.core.mail import send_mail

    customer = order.customer
    if not customer or not customer.email:
        return False
    shop = ShopSettings.get().shopName
    text = (
        f"{customer.name},\n\n"
        f"Votre commande n°{order.orderId} est prête. Vous pouvez passer la récupérer. Merci !\n"
        f"طلبيتكم رقم {order.orderId} جاهزة. يمكنكم المرور لاستلامها. شكرًا!\n"
        f"Your order #{order.orderId} is ready to collect. Thank you!\n\n— {shop}"
    )
    try:
        send_mail(f"{shop} – commande n°{order.orderId}", text, None, [customer.email])
        return True
    except Exception:  # noqa: BLE001 - a mail problem must never block work
        logger.exception("Could not send order-ready email for order %s", order.orderId)
        return False


# --------------------------------------------------------------------------- bills
def _release_stock(item):
    item.status, item.soldAt = "instock", None
    bump(item)
    item.save(update_fields=["status", "soldAt", "version"])


def _sync_bill_lines(bill, lines, pq, shop):
    existing = {l.lineId: l for l in bill.lines.select_related("stockItem")}
    keep = set()
    for data in lines:
        line_id = data.get("lineId")
        if line_id:
            line = existing.get(line_id)
            if line is None:
                raise ValidationError({"items": f"Line {line_id} does not belong to this bill."})
        else:
            line = BillLine(bill=bill)

        # a piece from stock: lock it so two people cannot sell it at the same moment
        item = None
        if data.get("stockItem"):
            item = StockItem.objects.select_for_update().filter(pk=data["stockItem"]).first()
            if item is None:
                raise ValidationError({"items": "This piece is no longer in stock."})
            if item.status != "instock" and line.stockItem_id != item.itemId:
                raise ValidationError({"items": f"{item.code} {item.name} is already sold or reserved."})
        if line.stockItem_id and (item is None or line.stockItem_id != item.itemId):
            _release_stock(line.stockItem)
        line.stockItem = item

        grade = grade_or_none(data.get("grade"), "items") or (item.grade if item else None) or bill.grade
        rate = data.get("rate")
        if rate is None:
            rate = bill.rate if grade == bill.grade and bill.rate else (latest_rate(grade).sellPrice if latest_rate(grade) else 0)
        line.name = data["name"].strip()
        line.grade = grade
        line.rate = rate or 0
        line.quantity = data.get("quantity") or 1
        line.netWeight = data["netWeight"]
        line.lossWeight = data.get("lossWeight") or 0
        line.makingMode = data.get("makingMode") or shop.defaultMakingMode
        line.makingCharge = data.get("makingCharge") or 0
        line.gemsName = (data.get("gemsName") or "").strip()
        line.gemsPrice = data.get("gemsPrice") or 0
        line.size = (data.get("size") or "").strip()
        t = calc.line_totals(line.netWeight, line.quantity, line.lossWeight, line.rate, line.makingMode,
                             line.makingCharge, line.gemsPrice, pq)
        line.totalWeight, line.metalAmount, line.makingAmount, line.amount = t["totalWeight"], t["metalAmount"], t["makingAmount"], t["amount"]
        line.save()
        keep.add(line.lineId)
        if item is not None:
            item.status = "sold" if bill.status == "submitted" else "reserved"
            item.soldAt = bill.date if bill.status == "submitted" else None
            bump(item)
            item.save(update_fields=["status", "soldAt", "version"])

    for line_id, line in existing.items():
        if line_id not in keep:
            if line.stockItem_id:
                _release_stock(line.stockItem)
            line.delete()


def recalc_bill(bill, pq=None):
    pq = pq or ShopSettings.get().priceQuantity
    lines = [{"amount": l.amount, "totalWeight": l.totalWeight} for l in bill.lines.all()]
    bill.laterPaid = calc.money(bill.payments.aggregate(s=Sum("amount"))["s"] or 0) if bill.pk else 0
    values = calc.bill_totals(
        lines, customer_weight=bill.customerMetalWeight, buy_rate=bill.buyRate, discount=bill.discount,
        tax_rate=bill.taxRate, advance=bill.advanceAmount, paid=bill.paidAmount, later=bill.laterPaid, pq=pq,
    )
    for field, value in values.items():
        setattr(bill, field, value)


@transaction.atomic
def save_bill(payload, user, bill=None):
    shop = ShopSettings.get()
    data = payload["bill"]
    if bill is not None:
        bill = Bill.objects.select_for_update().get(pk=bill.pk)
        check_version(bill, payload.get("version"))
        if bill.status == "submitted" and not user.is_owner:
            raise PermissionDenied("Only the owner can change a bill that is already saved. Ask the owner.")
    if (data.get("discount") or 0) > 0 and not user.is_owner and not shop.employeesCanDiscount:
        raise PermissionDenied("Only the owner can give a discount.")

    order = None
    if data.get("orderId"):
        order = Order.objects.select_for_update().filter(pk=data["orderId"]).first()
        if order is None:
            raise ValidationError({"bill": "The linked order does not exist."})

    customer_data = dict(payload.get("customer") or {})
    has_customer = customer_data.get("customerId") or (customer_data.get("name") or "").strip()
    if not customer_data.get("customerId"):
        if order is not None:
            customer_data["customerId"] = order.customer_id
        elif bill is not None and bill.customer_id and not has_customer:
            customer_data["customerId"] = bill.customer_id
    customer = resolve_customer(customer_data) if (customer_data.get("customerId") or (customer_data.get("name") or "").strip()) else None

    status = data.get("status", "submitted")
    if order is not None and status == "submitted":
        clash = Bill.objects.filter(order=order, status="submitted")
        if bill is not None:
            clash = clash.exclude(pk=bill.pk)
        if clash.exists():
            raise ValidationError({"bill": f"Order #{order.orderId} already has a saved bill."})

    creating = bill is None
    was_submitted = not creating and bill.status == "submitted"
    if creating:
        bill = Bill(createdBy=user)
    else:
        bump(bill)
    bill.customer = customer
    bill.order = order
    bill.date = data.get("date") or bill.date or localdate()
    bill.grade = grade_or_none(data.get("grade")) or (order.grade if order else None)
    rate = data.get("rate")
    if not rate and bill.grade:
        r = latest_rate(bill.grade)
        rate = r.sellPrice if r else None
    bill.rate = rate
    bill.customerMetalWeight = data.get("customerMetalWeight") or 0
    bill.customerMetalGrade = grade_or_none(data.get("customerMetalGrade"), "customerMetalGrade") or bill.grade
    buy = data.get("buyRate")
    if buy is None and bill.customerMetalWeight and bill.customerMetalGrade:
        r = latest_rate(bill.customerMetalGrade)
        buy = (r.buyPrice or r.sellPrice) if r else 0
    bill.buyRate = buy or 0
    bill.discount = data.get("discount") or 0
    bill.taxRate = shop.taxRate if creating else bill.taxRate
    bill.advanceAmount = data.get("advanceAmount") or 0
    bill.paidAmount = data.get("paidAmount") or 0
    bill.payMethod = data.get("payMethod") or "cash"
    bill.status = status
    bill.note = (data.get("note") or "").strip()
    bill.save()

    _sync_bill_lines(bill, payload["items"], shop.priceQuantity, shop)
    recalc_bill(bill, shop.priceQuantity)
    if bill.remainingAmount < -0.005:
        raise ValidationError({"bill": "Paid + advance is more than the bill total."})
    bill.save()
    transaction.on_commit(lambda: bill.refresh_qr())

    if order is not None:
        if status == "submitted":
            order.status, order.deliveredDate = "submitted", localdate()
            order.save(update_fields=["status", "deliveredDate", "updatedAt"])
        elif was_submitted and order.status == "submitted":
            order.status, order.deliveredDate = "completed", None
            order.save(update_fields=["status", "deliveredDate", "updatedAt"])
            recompute_order_status(order)
    who = customer.name if customer else "-"
    log(user, "bill.create" if creating else "bill.update", "bill", bill.billId, f"#{bill.billId} {who} {bill.grandTotal:.2f}")
    return bill


@transaction.atomic
def add_bill_payment(bill, data, user):
    bill = Bill.objects.select_for_update().get(pk=bill.pk)
    if bill.status != "submitted":
        raise ValidationError({"amount": "Save the bill before recording payments."})
    amount = calc.money(data["amount"])
    if bill.remainingAmount <= 0.005:
        raise ValidationError({"amount": "This bill is already fully paid."})
    if amount > bill.remainingAmount + 0.005:
        raise ValidationError({"amount": f"Payment is more than the remaining {bill.remainingAmount:.2f}."})
    BillPayment.objects.create(bill=bill, amount=amount, method=data.get("method") or "cash",
                               date=data.get("date") or localdate(), createdBy=user)
    recalc_bill(bill)
    bump(bill)
    bill.save()
    transaction.on_commit(lambda: bill.refresh_qr())
    log(user, "bill.payment", "bill", bill.billId, f"#{bill.billId} +{amount:.2f}")
    return bill


@transaction.atomic
def delete_bill_payment(payment, user):
    require_owner(user)
    bill = Bill.objects.select_for_update().get(pk=payment.bill_id)
    payment.delete()
    recalc_bill(bill)
    bump(bill)
    bill.save()
    log(user, "bill.payment_delete", "bill", bill.billId, f"#{bill.billId}")
    return bill


@transaction.atomic
def delete_bill(bill, user):
    require_owner(user)
    bill = Bill.objects.select_for_update().get(pk=bill.pk)
    order = bill.order
    for line in bill.lines.select_related("stockItem"):
        if line.stockItem_id:
            _release_stock(line.stockItem)
    if bill.qr_code:
        bill.qr_code.delete(save=False)
    log(user, "bill.delete", "bill", bill.billId, f"#{bill.billId}")
    was_submitted = bill.status == "submitted"
    bill.delete()
    if order is not None and was_submitted and order.status == "submitted":
        order.status, order.deliveredDate = "completed", None
        order.save(update_fields=["status", "deliveredDate", "updatedAt"])
        recompute_order_status(order)


# --------------------------------------------------------------------------- stock
@transaction.atomic
def create_stock(data, user):
    qty = data.pop("quantity", None) or 1
    data.pop("version", None)
    items = []
    for i in range(qty):
        values = dict(data)
        if not values.get("code") or i > 0:
            values["code"] = next_stock_code()
        item = StockItem.objects.create(createdBy=user, **values)
        items.append(item)
    log(user, "stock.create", "stock", items[0].itemId, f"{items[0].code} {items[0].name}" + (f" ×{qty}" if qty > 1 else ""))
    return items


# --------------------------------------------------------------------------- craftsmen work
@transaction.atomic
def give_work(data, user):
    staff = Staff.objects.filter(pk=data["staff"]).first()
    if staff is None:
        raise ValidationError({"staff": "Craftsman not found."})
    if staff.resignDate:
        raise ValidationError({"staff": f"{staff.staffName} has left and cannot get new work."})
    it = OrderItem.objects.select_for_update().select_related("order").filter(pk=data.get("orderItem")).first()
    if it is None:
        raise ValidationError({"orderItem": "Order item not found."})
    if it.status != "pending":
        raise ValidationError({"orderItem": "This item is already with a craftsman."})
    if it.order.status == "submitted":
        raise ValidationError({"orderItem": "This order is already delivered."})
    added = data.get("addedWeight") or 0
    work = StaffWork.objects.create(
        staff=staff, orderItem=it, date=data.get("date") or localdate(), givenWeight=data["givenWeight"],
        addedWeight=added, totalWeight=calc.weight(data["givenWeight"] + added), dueDate=data.get("dueDate"),
        wage=data.get("wage"), createdBy=user,
    )
    it.status = "inprogress"
    it.save(update_fields=["status"])
    recompute_order_status(it.order)
    log(user, "work.give", "order", it.order_id, f"{it.name} → {staff.staffName}")
    return work


@transaction.atomic
def edit_work(work, data, user):
    work = StaffWork.objects.select_for_update().get(pk=work.pk)
    if work.status == "completed":
        raise ValidationError({"work": "Received work cannot be edited."})
    staff = Staff.objects.filter(pk=data["staff"]).first()
    if staff is None:
        raise ValidationError({"staff": "Craftsman not found."})
    if staff.resignDate and staff.pk != work.staff_id:
        raise ValidationError({"staff": f"{staff.staffName} has left and cannot get new work."})
    work.staff = staff
    work.date = data.get("date") or work.date
    work.givenWeight = data["givenWeight"]
    work.addedWeight = data.get("addedWeight") or 0
    work.totalWeight = calc.weight(work.givenWeight + work.addedWeight)
    work.dueDate = data.get("dueDate")
    work.wage = data.get("wage")
    work.save()
    log(user, "work.update", "order", work.orderItem.order_id, work.orderItem.name)
    return work


@transaction.atomic
def receive_work(work, data, user):
    work = StaffWork.objects.select_for_update().get(pk=work.pk)
    if work.status == "completed":
        raise ValidationError({"work": "This work was already received."})
    returned = data["returnedWeight"]
    loss = data.get("lossWeight")
    work.returnedWeight = returned
    work.lossWeight = loss if loss is not None else calc.weight(max(work.totalWeight - returned, 0))
    work.returnedDate = data.get("returnedDate") or localdate()
    if data.get("wage") is not None:
        work.wage = data["wage"]
    work.status = "completed"
    work.save()
    it = work.orderItem
    it.status = "completed"
    it.save(update_fields=["status"])
    order = it.order
    before = order.status
    after = recompute_order_status(order)
    if after == "completed" and before != "completed":
        transaction.on_commit(lambda: send_order_ready_email(order))
    log(user, "work.receive", "order", order.orderId, f"{it.name} ← {work.staff.staffName}")
    return work


@transaction.atomic
def delete_work(work, user):
    if work.status != "inprogress":
        raise ValidationError({"work": "Only work that is still with the craftsman can be taken back."})
    it = work.orderItem
    work.delete()
    if not it.works.exists():
        it.status = "pending"
        it.save(update_fields=["status"])
    recompute_order_status(it.order)
    log(user, "work.delete", "order", it.order_id, it.name)


# --------------------------------------------------------------------------- suppliers
def supplier_balance(supplier):
    bought = supplier.purchases.aggregate(s=Sum("totalAmount"))["s"] or 0
    paid = supplier.payments.aggregate(s=Sum("amount"))["s"] or 0
    return calc.money(bought - paid)


@transaction.atomic
def save_purchase(data, user):
    shop = ShopSettings.get()
    supplier = Supplier.objects.filter(pk=data["supplier"]).first()
    if supplier is None:
        raise ValidationError({"supplier": "Supplier not found."})
    grade = grade_or_none(data.get("grade"))
    purchase = Purchase.objects.create(
        supplier=supplier, date=data.get("date") or localdate(), reference=(data.get("reference") or "").strip(),
        grade=grade, note=(data.get("note") or "").strip(), createdBy=user,
    )
    total_w = total_a = 0
    pq = shop.priceQuantity or 1
    for row in data["lines"]:
        qty = row.get("quantity") or 1
        amount = calc.money(row["weight"] * (row.get("unitPrice") or 0) / pq + (row.get("makingCharge") or 0))
        PurchaseLine.objects.create(purchase=purchase, name=row["name"].strip(), quantity=qty, weight=row["weight"],
                                    unitPrice=row.get("unitPrice") or 0, makingCharge=row.get("makingCharge") or 0, amount=amount)
        total_w += row["weight"]
        total_a += amount
        if row.get("addToStock"):
            pieces = max(int(qty), 1)
            for _ in range(pieces):
                StockItem.objects.create(
                    code=next_stock_code(), name=row["name"].strip(), grade=grade, weight=calc.weight(row["weight"] / pieces),
                    costPrice=calc.money(amount / pieces), supplier=supplier, makingMode=shop.defaultMakingMode, createdBy=user,
                )
    purchase.totalWeight, purchase.totalAmount = calc.weight(total_w), calc.money(total_a)
    purchase.save()
    if data.get("paidNow"):
        if data["paidNow"] > purchase.totalAmount + 0.005:
            raise ValidationError({"paidNow": "Paid is more than the purchase total."})
        SupplierPayment.objects.create(supplier=supplier, purchase=purchase, amount=calc.money(data["paidNow"]),
                                       method=data.get("payMethod") or "cash", date=purchase.date, createdBy=user)
    log(user, "purchase.create", "supplier", supplier.supplierId, f"{supplier.name} {purchase.totalAmount:.2f}")
    return purchase


@transaction.atomic
def add_supplier_payment(data, user):
    shop = ShopSettings.get()
    supplier = Supplier.objects.filter(pk=data["supplier"]).first()
    if supplier is None:
        raise ValidationError({"supplier": "Supplier not found."})
    purchase = None
    if data.get("purchase"):
        purchase = Purchase.objects.filter(pk=data["purchase"], supplier=supplier).first()
        if purchase is None:
            raise ValidationError({"purchase": "This purchase is not from this supplier."})
    amount = data.get("amount")
    grade = None
    if data["method"] == "metal":
        if not data.get("metalWeight"):
            raise ValidationError({"metalWeight": "Enter the weight of metal given."})
        grade = grade_or_none(data.get("metalGrade"), "metalGrade")
        rate = data.get("metalRate")
        if rate is None and grade:
            r = latest_rate(grade)
            rate = r.sellPrice if r else None
        if not rate:
            raise ValidationError({"metalRate": "Enter the rate used for this metal."})
        amount = data["metalWeight"] * rate / (shop.priceQuantity or 1)
    if not amount or amount <= 0:
        raise ValidationError({"amount": "Enter the amount paid."})
    p = SupplierPayment.objects.create(
        supplier=supplier, purchase=purchase, date=data.get("date") or localdate(), method=data["method"],
        amount=calc.money(amount), metalWeight=data.get("metalWeight") if data["method"] == "metal" else None,
        metalGrade=grade, note=(data.get("note") or "").strip(), createdBy=user,
    )
    log(user, "supplier.payment", "supplier", supplier.supplierId, f"{supplier.name} {p.amount:.2f}")
    return p
