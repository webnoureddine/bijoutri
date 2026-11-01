"""All money / weight maths. The server is the single source of truth; the frontend mirrors this in calc.js.

The daily price is for `pq` weight units (ShopSettings.priceQuantity, 1 = per gram).

Line:  total weight = net weight per piece x quantity + loss
       metal        = total weight x rate / pq
       making       = fixed:     charge x quantity
                      perWeight: charge x total weight / pq
                      percent:   metal x charge / 100
       stones       = stone price per piece x quantity
       amount       = metal + making + stones
Bill:  subtotal - discount + tax(on subtotal - discount) - old metal (weight x buy rate / pq) = grand total
       remaining = grand total - advance - paid now - later payments
"""


def num(value, default=0.0):
    if value is None or value == "":
        return default
    return float(value)


def money(value):
    return round(num(value), 2)


def weight(value):
    return round(num(value), 3)


def line_totals(net_weight, quantity, loss, rate, making_mode, making_charge, gems_price, pq=1):
    pq = num(pq) or 1
    qty = num(quantity) or 1
    total_weight = num(net_weight) * qty + num(loss)
    metal = total_weight * num(rate) / pq
    charge = num(making_charge)
    if making_mode == "fixed":
        making = charge * qty
    elif making_mode == "percent":
        making = metal * charge / 100
    else:
        making = charge * total_weight / pq
    amount = metal + making + num(gems_price) * qty
    return {"totalWeight": weight(total_weight), "metalAmount": money(metal), "makingAmount": money(making), "amount": money(amount)}


def bill_totals(lines, *, customer_weight=0, buy_rate=0, discount=0, tax_rate=0, advance=0, paid=0, later=0, pq=1):
    """lines: iterable of dicts from line_totals."""
    pq = num(pq) or 1
    lines = list(lines)
    subtotal = sum(l["amount"] for l in lines)
    final_weight = sum(l["totalWeight"] for l in lines)
    customer_amount = num(customer_weight) * num(buy_rate) / pq
    taxable = max(subtotal - num(discount), 0)
    tax = taxable * num(tax_rate) / 100
    grand = taxable + tax - customer_amount
    remaining = grand - num(advance) - num(paid) - num(later)
    return {
        "finalWeight": weight(final_weight),
        "subtotal": money(subtotal),
        "customerMetalAmount": money(customer_amount),
        "taxAmount": money(tax),
        "grandTotal": money(grand),
        "remainingAmount": money(remaining),
    }
