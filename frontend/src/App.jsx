import { useCallback } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { t } from './i18n';
import { ShopProvider } from './shop.jsx';
import { Loading, useUi } from './ui.jsx';
import Layout from './components/Layout.jsx';
import Login, { ForgotPassword, ResetPassword } from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Sell from './pages/Sell.jsx';
import Bills from './pages/Bills.jsx';
import BillView from './pages/BillView.jsx';
import Stock, { Labels, StockDetail } from './pages/Stock.jsx';
import Orders from './pages/Orders.jsx';
import OrderForm from './pages/OrderForm.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import Customers, { CustomerDetail } from './pages/Customers.jsx';
import Craftsmen, { StaffDetail } from './pages/Craftsmen.jsx';
import Suppliers, { SupplierDetail } from './pages/Suppliers.jsx';
import Rates from './pages/Rates.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  const { user, ready, isOwner } = useAuth();
  const ui = useUi();
  const onRemoteChange = useCallback((a) => {
    if (a.user?.name) ui.info(t('Updated by {name}', { name: a.user.name }));
  }, [ui]);

  if (!ready) return <Loading />;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <ShopProvider onRemoteChange={onRemoteChange}>
      <Routes>
        <Route path="stock/labels" element={<Labels />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="sell" element={<Sell />} />
          <Route path="bills" element={<Bills />} />
          <Route path="bills/:id" element={<BillView />} />
          <Route path="bills/:id/edit" element={<Sell />} />
          <Route path="stock" element={<Stock />} />
          <Route path="stock/:id" element={<StockDetail />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/new" element={<OrderForm />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="orders/:id/edit" element={<OrderForm />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/:id" element={<CustomerDetail />} />
          <Route path="craftsmen" element={<Craftsmen />} />
          <Route path="craftsmen/:id" element={<StaffDetail />} />
          {isOwner && <Route path="suppliers" element={<Suppliers />} />}
          {isOwner && <Route path="suppliers/:id" element={<SupplierDetail />} />}
          <Route path="rates" element={<Rates />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ShopProvider>
  );
}
