import test from "node:test";
import assert from "node:assert/strict";
import {
  affectsIncomeExpense,
  countsAsIncome,
  countsAsPersonalExpense,
  isPayable,
  isReceivable,
  isSettlement,
  isTransfer,
  accountBalanceDeltas,
  personalExpenseAmount,
  summarizeOutstandingByType
} from "../src/utils/financeRules.js";

test("income and personal expense classifications stay separate from loans and transfers", () => {
  assert.equal(countsAsIncome("INCOME"), true);
  assert.equal(countsAsPersonalExpense("EXPENSE"), true);
  assert.equal(countsAsPersonalExpense("PAID_BY_SOMEONE"), false);
  assert.equal(countsAsPersonalExpense("SPLIT_EXPENSE"), true);

  assert.equal(countsAsIncome("BORROW"), false);
  assert.equal(countsAsPersonalExpense("LEND"), false);
  assert.equal(affectsIncomeExpense("TRANSFER"), false);
  assert.equal(affectsIncomeExpense("REPAYMENT_RECEIVED"), false);
  assert.equal(affectsIncomeExpense("REPAYMENT_PAID"), false);
});

test("account effects and personal expense shares follow the accounting contract", () => {
  assert.deepEqual(accountBalanceDeltas({ type: "INCOME", amount: 100, account: "bank" }), [{ accountId: "bank", delta: 100 }]);
  assert.deepEqual(accountBalanceDeltas({ type: "BORROW", amount: 100, account: "bank" }), [{ accountId: "bank", delta: 100 }]);
  assert.deepEqual(accountBalanceDeltas({ type: "EXPENSE", amount: 30, account: "cash" }), [{ accountId: "cash", delta: -30 }]);
  assert.deepEqual(accountBalanceDeltas({ type: "LEND", amount: 20, account: "cash" }), [{ accountId: "cash", delta: -20 }]);
  assert.deepEqual(accountBalanceDeltas({ type: "PAID_FOR_SOMEONE", amount: 20, account: "cash" }), [{ accountId: "cash", delta: -20 }]);
  assert.deepEqual(accountBalanceDeltas({ type: "PAID_BY_SOMEONE", amount: 20 }), []);
  assert.deepEqual(accountBalanceDeltas({ type: "REPAYMENT_RECEIVED", amount: 10, account: "cash" }), [{ accountId: "cash", delta: 10 }]);
  assert.deepEqual(accountBalanceDeltas({ type: "REPAYMENT_PAID", amount: 10, account: "cash" }), [{ accountId: "cash", delta: -10 }]);
  assert.deepEqual(accountBalanceDeltas({ type: "SPLIT_EXPENSE", amount: 90, account: "bank" }), [{ accountId: "bank", delta: -90 }]);
  assert.deepEqual(accountBalanceDeltas({ type: "TRANSFER", amount: 25, account: "cash", destinationAccount: "bank" }), [
    { accountId: "cash", delta: -25 },
    { accountId: "bank", delta: 25 }
  ]);
  assert.equal(personalExpenseAmount({ type: "SPLIT_EXPENSE", amount: 90, myShare: 30 }), 30);
  assert.equal(personalExpenseAmount({ type: "PAID_FOR_SOMEONE", amount: 20 }), 0);
  assert.equal(personalExpenseAmount({ type: "PAID_BY_SOMEONE", amount: 20 }), 0);
});

test("outstanding summaries combine split shares only into receivables", () => {
  assert.deepEqual(summarizeOutstandingByType([
    { _id: "LEND", total: 100 },
    { _id: "PAID_FOR_SOMEONE", total: 20 },
    { _id: "SPLIT_SHARE", total: 60 },
    { _id: "BORROW", total: 40 },
    { _id: "PAID_BY_SOMEONE", total: 10 }
  ]), {
    lentOutstanding: 100,
    paidForSomeoneOutstanding: 80,
    borrowedOutstanding: 40,
    someonePaidForMeOutstanding: 10,
    totalToReceive: 180,
    totalToPay: 50
  });
});

test("person ledger classifications support receivable, payable, settlement and transfer flows", () => {
  assert.equal(isReceivable("LEND"), true);
  assert.equal(isReceivable("PAID_FOR_SOMEONE"), true);
  assert.equal(isPayable("BORROW"), true);
  assert.equal(isPayable("PAID_BY_SOMEONE"), true);
  assert.equal(isSettlement("REPAYMENT_RECEIVED"), true);
  assert.equal(isSettlement("REPAYMENT_PAID"), true);
  assert.equal(isTransfer("TRANSFER"), true);
});
