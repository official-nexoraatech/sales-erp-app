import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';

const sampleChartData = [
  { month: 'Jan', sales: 4000, purchases: 2400 },
  { month: 'Feb', sales: 3000, purchases: 1398 },
  { month: 'Mar', sales: 2000, purchases: 9800 },
  { month: 'Apr', sales: 2780, purchases: 3908 },
  { month: 'May', sales: 1890, purchases: 4800 },
];

const samplePieData = [
  { name: 'Customers', value: 245 },
  { name: 'Suppliers', value: 87 },
  { name: 'Items', value: 1203 },
  { name: 'Orders', value: 542 },
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

export const DashboardPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Welcome to BillTop - Your Billing & Inventory Management System"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <div className="text-center">
            <p className="text-gray-600 text-sm font-medium">Total Sales</p>
            <h3 className="text-3xl font-bold text-blue-600 mt-2">₹45,250</h3>
            <p className="text-gray-500 text-xs mt-1">↑ 12% from last month</p>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <p className="text-gray-600 text-sm font-medium">Total Purchases</p>
            <h3 className="text-3xl font-bold text-green-600 mt-2">₹28,500</h3>
            <p className="text-gray-500 text-xs mt-1">↓ 5% from last month</p>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <p className="text-gray-600 text-sm font-medium">Active Customers</p>
            <h3 className="text-3xl font-bold text-purple-600 mt-2">245</h3>
            <p className="text-gray-500 text-xs mt-1">12 new this month</p>
          </div>
        </Card>
        <Card>
          <div className="text-center">
            <p className="text-gray-600 text-sm font-medium">Inventory Value</p>
            <h3 className="text-3xl font-bold text-orange-600 mt-2">₹1.2M</h3>
            <p className="text-gray-500 text-xs mt-1">1,203 items in stock</p>
          </div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Sales vs Purchases
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={sampleChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="sales" fill="#3b82f6" />
              <Bar dataKey="purchases" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Entity Distribution
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={samplePieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, value }) => `${name}: ${value}`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {samplePieData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b">
            <div>
              <p className="text-sm font-medium text-gray-900">
                Invoice INV-001 created
              </p>
              <p className="text-xs text-gray-500">Customer: Acme Corp</p>
            </div>
            <span className="text-xs text-gray-500">2 hours ago</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b">
            <div>
              <p className="text-sm font-medium text-gray-900">
                Purchase order PO-045 received
              </p>
              <p className="text-xs text-gray-500">Supplier: Tech Supplies Inc</p>
            </div>
            <span className="text-xs text-gray-500">4 hours ago</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-gray-900">
                New customer registered
              </p>
              <p className="text-xs text-gray-500">Customer: New Business Ltd</p>
            </div>
            <span className="text-xs text-gray-500">1 day ago</span>
          </div>
        </div>
      </Card>
    </div>
  );
};
