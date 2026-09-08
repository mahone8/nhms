/**
 * Full-lifecycle smoke test: admission -> check-in -> payment -> transfer
 * -> check-out, plus RBAC spot-checks. Run with the app already running.
 *   node scripts/qa-smoke-test.js http://localhost:3001
 */
const BASE = process.argv[2] || "http://localhost:3001";
let failures = 0;

function assert(cond, label) {
  if (cond) console.log(`PASS: ${label}`);
  else { console.error(`FAIL: ${label}`); failures++; }
}

async function req(method, path, body, cookie) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  const data = await res.json().catch(() => null);
  return { status: res.status, data, cookie: setCookie ? setCookie.split(";")[0] : cookie };
}

async function main() {
  const health = await req("GET", "/api/health");
  assert(health.status === 200 && health.data.ok, "health check");

  const adminLogin = await req("POST", "/api/auth/login", { username: "admin", password: "Admin123!" });
  assert(adminLogin.status === 200, "admin login");
  const adminCookie = adminLogin.cookie;

  const adm = await req("POST", "/api/admissions", { fullName: "QA Test Resident" }, adminCookie);
  assert(adm.status === 201, "create admission");
  const admId = adm.data.id;
  await req("PATCH", `/api/admissions/${admId}/status`, { status: "registration" }, adminCookie);
  await req("PATCH", `/api/admissions/${admId}/status`, { status: "verification" }, adminCookie);
  const branchSet = await req("PATCH", `/api/admissions/${admId}/branch`, { branchId: 1 }, adminCookie);
  assert(branchSet.status === 200, "set admission branch");
  const beds = await req("GET", `/api/admissions/${admId}/available-beds`, null, adminCookie);
  assert(beds.status === 200 && beds.data.length > 0, "available beds listed");
  const bedId = beds.data[0].id;
  const bedSet = await req("PATCH", `/api/admissions/${admId}/bed`, { bedId }, adminCookie);
  assert(bedSet.status === 200, "select bed");
  await req("PATCH", `/api/admissions/${admId}`, { registrationFee: 5000, securityFee: 15000 }, adminCookie);
  const confirmed = await req("PATCH", `/api/admissions/${admId}/status`, { status: "confirmed" }, adminCookie);
  assert(confirmed.status === 200, "confirm admission");

  const checkIn = await req("POST", "/api/check-in", { admissionId: admId, username: `qa${Date.now()}`, password: "Resident123!" }, adminCookie);
  assert(checkIn.status === 201, "check-in");
  const residentId = checkIn.data.id;

  const duesBefore = await req("GET", `/api/residents/${residentId}/dues`, null, adminCookie);
  assert(duesBefore.data.totalCharges === 52000, "dues total after check-in = 52000");

  const payment = await req("POST", "/api/payments", { residentId, amount: 20000, paymentType: "monthly_rent", paymentMethod: "cash" }, adminCookie);
  assert(payment.status === 201 && payment.data.receiptNumber, "record payment, receipt generated");

  const duesAfter = await req("GET", `/api/residents/${residentId}/dues`, null, adminCookie);
  assert(duesAfter.data.remainingBalance === 32000, "outstanding balance correct after payment");

  const beds2 = await req("GET", `/api/beds/branch/1`, null, adminCookie);
  const freeBed = beds2.data.find((b) => b.status === "available" && b.id !== bedId);
  const transfer = await req("POST", "/api/transfers", { residentId, bedId: freeBed.id, reason: "QA test" }, adminCookie);
  assert(transfer.status === 200, "transfer resident");

  const stayHistory = await req("GET", `/api/residents/${residentId}/stay-history`, null, adminCookie);
  assert(stayHistory.data.length === 2, "stay history has 2 rows after transfer");
  assert(stayHistory.data[0].endDate !== null, "original assignment closed with end date");

  const checkOut = await req("POST", "/api/check-out", { residentId }, adminCookie);
  assert(checkOut.status === 200 && checkOut.data.status === "checked_out", "check-out");

  const residentLogin = await req("POST", "/api/auth/login", { username: "testresident", password: "Resident123!" });
  const residentCookie = residentLogin.cookie;
  const forbidden = await req("GET", "/api/residents", null, residentCookie);
  assert(forbidden.status === 403, "resident blocked from admin resident list");
  const unauth = await req("GET", "/api/dashboard");
  assert(unauth.status === 401 || unauth.status === 403, "unauthenticated request blocked from dashboard");

  console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error("QA script crashed:", err); process.exit(1); });
