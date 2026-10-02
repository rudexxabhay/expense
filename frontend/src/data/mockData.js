import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Bus,
  Coffee,
  CreditCard,
  Gift,
  Home,
  Plane,
  Receipt,
  ShoppingBag,
  Utensils
} from "lucide-react";

export const overview = {
  balance: "₹84,260",
  income: "₹1,42,000",
  spent: "₹57,740",
  toReceive: "₹8,450",
  toPay: "₹3,200",
  monthSpent: "₹57,740",
  monthBudget: "₹90,000",
  savings: "₹84,260"
};

export const spendBars = [
  { label: "Food", value: 64, color: "bg-coral" },
  { label: "Travel", value: 42, color: "bg-income" },
  { label: "Home", value: 28, color: "bg-primary" },
  { label: "Fun", value: 22, color: "bg-amber" }
];

export const shortcuts = [
  { label: "Expense", icon: Receipt, tone: "coral" },
  { label: "Income", icon: Banknote, tone: "income" },
  { label: "Lend", icon: ArrowUpRight, tone: "emerald" },
  { label: "Borrow", icon: ArrowDownLeft, tone: "amber" }
];

export const transactions = [
  {
    id: 1,
    title: "Rent for September",
    person: "Home",
    amount: "-₹28,000",
    date: "Today, 9:12 AM",
    type: "Expense",
    state: "spent",
    icon: Home,
    category: "Housing"
  },
  {
    id: 2,
    title: "Salary credited",
    person: "Axis Bank",
    amount: "+₹1,20,000",
    date: "Today, 8:00 AM",
    type: "Income",
    state: "income",
    icon: Banknote,
    category: "Salary"
  },
  {
    id: 3,
    title: "Dinner split",
    person: "Riya owes you",
    amount: "+₹1,250",
    date: "Yesterday",
    type: "Receive",
    state: "receive",
    icon: Utensils,
    category: "Food"
  },
  {
    id: 4,
    title: "Airport cab",
    person: "You owe Kabir",
    amount: "-₹900",
    date: "Mon, 7:45 PM",
    type: "Pay",
    state: "pay",
    icon: Bus,
    category: "Travel"
  },
  {
    id: 5,
    title: "Weekend stay booking",
    person: "Borrowed from Neha",
    amount: "₹2,300",
    date: "Sun, 3:21 PM",
    type: "Borrowed",
    state: "borrowed",
    icon: Plane,
    category: "Travel"
  },
  {
    id: 6,
    title: "Coffee with team",
    person: "Blue Tokai",
    amount: "-₹760",
    date: "Sat, 11:18 AM",
    type: "Expense",
    state: "spent",
    icon: Coffee,
    category: "Food"
  },
  {
    id: 7,
    title: "Gift advance",
    person: "Aarav owes you",
    amount: "+₹3,000",
    date: "Fri, 6:30 PM",
    type: "Lent",
    state: "owed",
    icon: Gift,
    category: "Personal"
  }
];

export const people = [
  {
    id: "riya",
    name: "Riya Sharma",
    note: "Dinner, groceries",
    balance: "+₹4,250",
    rawBalance: 4250,
    tone: "emerald",
    initials: "RS"
  },
  {
    id: "aarav",
    name: "Aarav Mehta",
    note: "Gift planning",
    balance: "+₹3,000",
    rawBalance: 3000,
    tone: "income",
    initials: "AM"
  },
  {
    id: "kabir",
    name: "Kabir Rao",
    note: "Travel split",
    balance: "-₹2,100",
    rawBalance: -2100,
    tone: "coral",
    initials: "KR"
  },
  {
    id: "neha",
    name: "Neha Kapoor",
    note: "Stay booking",
    balance: "-₹1,100",
    rawBalance: -1100,
    tone: "amber",
    initials: "NK"
  }
];

export const personLedger = [
  { title: "Dinner split", amount: "+₹1,250", date: "Yesterday", type: "Receive" },
  { title: "Groceries paid", amount: "+₹2,400", date: "Sep 24", type: "Lent" },
  { title: "Cafe settled", amount: "-₹600", date: "Sep 20", type: "Pay" },
  { title: "Movie tickets", amount: "+₹1,200", date: "Sep 15", type: "Receive" }
];

export const categories = [
  { name: "Food & Dining", amount: "₹14,850", change: "+8%", icon: Utensils, color: "coral", width: "78%" },
  { name: "Travel", amount: "₹11,200", change: "-3%", icon: Plane, color: "income", width: "62%" },
  { name: "Shopping", amount: "₹8,640", change: "+5%", icon: ShoppingBag, color: "amber", width: "46%" },
  { name: "Bills", amount: "₹6,900", change: "0%", icon: CreditCard, color: "primary", width: "38%" }
];

export const addOptions = [
  "Expense",
  "Income",
  "Paid for Someone",
  "Someone Paid for Me",
  "Lend Money",
  "Borrow Money",
  "Settle Up",
  "Transfer",
  "Split Expense"
];
