from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from . import models as m


@admin.register(m.User)
class AdminUser(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("Shop", {"fields": ("role", "full_name", "phone", "jobTitle", "profileImage", "totpEnabled", "lockedUntil")}),)
    list_display = ("id", "username", "full_name", "email", "role", "is_active")


for model in (m.ShopSettings, m.MetalGrade, m.Rate, m.Customer, m.Supplier, m.Purchase, m.SupplierPayment, m.Staff,
              m.CatalogProduct, m.StockItem, m.Order, m.OrderItem, m.StaffWork, m.Bill, m.BillLine, m.BillPayment,
              m.Activity, m.LoginEvent):
    admin.site.register(model)
