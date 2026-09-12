const TAB_TITLES = {
  dashboard: "Dashboard", profile: "My Profile", room: "My Room", dues: "My Dues",
  payments: "Payment History", receipts: "Receipts", stay: "Stay Information", notices: "Notices",
};

let currentTab = "dashboard";
const content = document.getElementById("content");
const modalRoot = document.getElementById("modalRoot");

function currency(n) { return n == null ? "—" : "Rs. " + Number(n).toLocaleString("en-PK"); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"; }

(async function init() {
  let me;
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) {
      // A transient error (a brief DB hiccup, a mid-request restart) is
      // NOT the same as "not logged in" -- bouncing to the login page
      // here would kick out a perfectly valid session just because one
      // request failed. Show a retry state instead of destroying the
      // session client-side.
      content.innerHTML = `<div class="empty-state">Having trouble reaching the server. <button class="btn-outline" onclick="location.reload()">Retry</button></div>`;
      return;
    }
    me = await res.json();
  } catch (err) {
    content.innerHTML = `<div class="empty-state">Could not reach the server. <button class="btn-outline" onclick="location.reload()">Retry</button></div>`;
    return;
  }
  if (!me.user || me.user.role !== "resident") {
    window.location.href = "/portal/";
    return;
  }
  document.getElementById("welcomeMsg").textContent = `Welcome, ${me.user.username}`;
  document.querySelectorAll(".nav-btn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/portal/";
  });
  render();
})();

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".nav-btn[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("pageTitle").textContent = TAB_TITLES[tab];
  render();
}

async function safeFetch(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function render() {
  content.innerHTML = `<p style="color:#8b8579;">Loading…</p>`;
  if (currentTab === "dashboard") return renderDashboard();
  if (currentTab === "profile") return renderProfile();
  if (currentTab === "room") return renderRoom();
  if (currentTab === "dues") return renderDues();
  if (currentTab === "payments") return renderPayments();
  if (currentTab === "receipts") return renderReceipts();
  if (currentTab === "stay") return renderStay();
  if (currentTab === "notices") return renderNotices();
}

/* ---------------- Dashboard ---------------- */

async function renderDashboard() {
  const [profile, dues, payments] = await Promise.all([
    safeFetch("/api/residents/me"),
    safeFetch("/api/residents/me/dues"),
    safeFetch("/api/payments/me"),
  ]);
  if (!profile) { content.innerHTML = emptyProfileNotice(); return; }

  const lastPayment = payments && payments[0];
  content.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="value">${esc(profile.fullName)}</div><div class="label">Name</div></div>
      <div class="stat-card"><div class="value">${esc(profile.branchName)}</div><div class="label">Branch</div></div>
      <div class="stat-card"><div class="value">${esc(profile.roomNumber) || "—"}</div><div class="label">Room</div></div>
      <div class="stat-card"><div class="value">${profile.bedNumber ?? "—"}</div><div class="label">Bed</div></div>
      <div class="stat-card"><div class="value">${esc(profile.roomType) || "—"}</div><div class="label">Room type</div></div>
      <div class="stat-card"><div class="value">${esc(profile.bathroomType) || "—"}</div><div class="label">Bathroom type</div></div>
      <div class="stat-card"><div class="value">${currency(profile.monthlyRent)}</div><div class="label">Monthly rent</div></div>
      <div class="stat-card"><div class="value">${currency(dues?.remainingBalance)}</div><div class="label">Outstanding balance</div></div>
      <div class="stat-card"><div class="value">${fmtDate(dues?.dueDate)}</div><div class="label">Next due date</div></div>
      <div class="stat-card"><div class="value">${lastPayment ? currency(lastPayment.amount) : "—"}</div><div class="label">Last payment${lastPayment ? " · " + fmtDate(lastPayment.payment_date) : ""}</div></div>
    </div>
    ${dues && (dues.status === "overdue" || dues.status === "due") ? `
      <div class="card" style="background:${dues.status === "overdue" ? "#fbecea" : "#fbf1e0"};border:none;font-size:14px;">
        ${dues.status === "overdue" ? "Your payment is overdue." : "You have a payment due."} Outstanding balance: ${currency(dues.remainingBalance)}.
      </div>` : ""}
  `;
}

function emptyProfileNotice() {
  return `<div class="empty-state">No resident profile is linked to this account yet. Please contact the front desk.</div>`;
}

/* ---------------- My Profile ---------------- */

async function renderProfile() {
  const p = await safeFetch("/api/residents/me");
  if (!p) { content.innerHTML = emptyProfileNotice(); return; }
  content.innerHTML = `
    <div class="two-col">
      <div class="card">
        <h3 style="margin-top:0;">Personal</h3>
        <div class="detail-row">&#128100; <b>${esc(p.fullName)}</b></div>
        <div class="detail-row">Father/Guardian: ${esc(p.fatherGuardianName) || "—"}</div>
        <div class="detail-row">CNIC: ${esc(p.cnic) || "—"}</div>
        <div class="detail-row">Date of birth: ${fmtDate(p.dateOfBirth)}</div>
        <div class="detail-row">&#128222; ${esc(p.phone) || "—"}</div>
        <div class="detail-row">Emergency contact: ${esc(p.emergencyContact) || "—"}</div>
        <div class="detail-row">Address: ${esc(p.permanentAddress) || "—"}</div>
      </div>
      <div class="card">
        <h3 style="margin-top:0;">Education</h3>
        <div class="detail-row">University: ${esc(p.university) || "—"}</div>
        <div class="detail-row">Department: ${esc(p.department) || "—"}</div>
        <div class="detail-row">Student ID: ${esc(p.studentId) || "—"}</div>
        <div class="detail-row">Program: ${esc(p.program) || "—"}</div>
        <div class="detail-row">Semester/Year: ${esc(p.semesterYear) || "—"}</div>
      </div>
      <div class="card">
        <h3 style="margin-top:0;">Hostel</h3>
        <div class="detail-row">Branch: ${esc(p.branchName)}</div>
        <div class="detail-row">Floor: ${esc(p.floor) || "—"}</div>
        <div class="detail-row">Room: ${esc(p.roomNumber) || "—"}</div>
        <div class="detail-row">Bed: ${p.bedNumber ?? "—"}</div>
        <div class="detail-row">Room type: ${esc(p.roomType) || "—"}</div>
        <div class="detail-row">Bathroom type: ${esc(p.bathroomType) || "—"}</div>
        <div class="detail-row">Joining date: ${fmtDate(p.joiningDate)}</div>
        <div class="detail-row">Expected checkout: ${fmtDate(p.expectedCheckoutDate)}</div>
        <div class="detail-row">Status: <span class="pill ${p.status === "active" ? "paid" : "pending"}">${esc(p.status)}</span></div>
      </div>
    </div>
  `;
}

/* ---------------- My Room ---------------- */

async function renderRoom() {
  const p = await safeFetch("/api/residents/me");
  if (!p) { content.innerHTML = emptyProfileNotice(); return; }
  content.innerHTML = `
    <div class="card" style="max-width:420px;">
      <div class="detail-row">Branch: <b>${esc(p.branchName)}</b></div>
      <div class="detail-row">Room: ${esc(p.roomNumber) || "—"} ${p.floor ? `(Floor ${esc(p.floor)})` : ""}</div>
      <div class="detail-row">Bed: ${p.bedNumber ?? "—"}</div>
      <div class="detail-row">Room type: ${esc(p.roomType) || "—"}</div>
      <div class="detail-row">Bathroom type: ${esc(p.bathroomType) || "—"}</div>
      <div class="detail-row">Monthly rent: ${currency(p.monthlyRent)}</div>
      <div class="detail-row">Joined: ${fmtDate(p.joiningDate)}</div>
      <div class="detail-row">Status: <span class="pill ${p.status === "active" ? "paid" : "pending"}">${esc(p.status)}</span></div>
    </div>
  `;
}

/* ---------------- My Dues ---------------- */

async function renderDues() {
  const d = await safeFetch("/api/residents/me/dues");
  if (!d) { content.innerHTML = emptyProfileNotice(); return; }
  content.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="value">${currency(d.monthlyRent)}</div><div class="label">Monthly rent charged</div></div>
      <div class="stat-card"><div class="value">${currency(d.securityFee)}</div><div class="label">Security fee</div></div>
      <div class="stat-card"><div class="value">${currency(d.registrationFee)}</div><div class="label">Registration fee</div></div>
      <div class="stat-card"><div class="value">${currency(d.otherCharges)}</div><div class="label">Other charges</div></div>
      <div class="stat-card"><div class="value">${currency(d.previousOutstanding)}</div><div class="label">Previous outstanding</div></div>
      <div class="stat-card"><div class="value">${currency(d.totalCharges)}</div><div class="label">Total charges</div></div>
      <div class="stat-card"><div class="value">${currency(d.amountPaid)}</div><div class="label">Amount paid</div></div>
      <div class="stat-card"><div class="value">${currency(d.remainingBalance)}</div><div class="label">Remaining balance</div></div>
      <div class="stat-card"><div class="value">${fmtDate(d.dueDate)}</div><div class="label">Due date</div></div>
      <div class="stat-card"><div class="value"><span class="pill ${d.status}">${d.status[0].toUpperCase() + d.status.slice(1)}</span></div><div class="label">Status</div></div>
    </div>
  `;
}

/* ---------------- Payment History ---------------- */

async function renderPayments() {
  const rows = await safeFetch("/api/payments/me") || [];
  content.innerHTML = `
    <div class="table-card">
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Method</th><th>Receipt #</th><th>Status</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((p) => `
              <tr>
                <td>${fmtDate(p.payment_date)}</td>
                <td>${esc(p.payment_type.replace("_", " "))}</td>
                <td>${currency(p.amount)}</td>
                <td>${esc(p.payment_method.replace("_", " "))}</td>
                <td>${esc(p.receipt_number)}</td>
                <td><span class="pill paid">${p.payment_type === "refund" ? "Refunded" : "Completed"}</span></td>
              </tr>`).join("") : `<tr><td colspan="6" style="text-align:center;color:#8b8579;padding:32px;">No payments recorded yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------------- Receipts ---------------- */

async function renderReceipts() {
  const rows = await safeFetch("/api/payments/me") || [];
  content.innerHTML = `
    <div class="table-card">
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Receipt #</th><th>Date</th><th>Amount</th><th></th></tr></thead>
          <tbody id="receiptRows">
            ${rows.length ? rows.map((p) => `
              <tr>
                <td>${esc(p.receipt_number)}</td>
                <td>${fmtDate(p.payment_date)}</td>
                <td>${currency(p.amount)}</td>
                <td style="text-align:right;"><button class="link-btn" data-id="${p.id}" style="color:#12161f;">View</button></td>
              </tr>`).join("") : `<tr><td colspan="4" style="text-align:center;color:#8b8579;padding:32px;">No receipts yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
  document.querySelectorAll("#receiptRows .link-btn").forEach((btn) => {
    btn.addEventListener("click", () => openReceipt(btn.dataset.id));
  });
}

async function openReceipt(id) {
  const r = await safeFetch(`/api/payments/me/${id}`);
  if (!r) return;
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="backdrop">
      <div class="modal-box">
        <button class="modal-close" id="modalCloseBtn">&times;</button>
        <h3>Receipt ${esc(r.receiptNumber)}</h3>
        <div class="detail-row">${esc(r.hostelName)}</div>
        <div class="detail-row">Resident: <b>${esc(r.residentName)}</b></div>
        <div class="detail-row">CNIC: ${esc(r.cnic) || "—"}</div>
        <div class="detail-row">Branch: ${esc(r.branchName)}</div>
        <div class="detail-row">Room / Bed: ${esc(r.roomNumber) || "—"} / ${r.bedNumber ?? "—"}</div>
        <div class="detail-row">Date: ${fmtDate(r.paymentDate)}</div>
        <div class="detail-row">Type: ${esc(r.paymentType.replace("_", " "))}</div>
        <div class="detail-row">Amount: <b>${currency(r.amount)}</b></div>
        <div class="detail-row">Method: ${esc(r.paymentMethod.replace("_", " "))}</div>
        <div class="detail-row">Received by: ${esc(r.receivedBy) || "—"}</div>
        <div class="detail-row">Remaining balance after this payment: ${currency(r.remainingBalance)}</div>
        <button class="btn-outline" style="width:100%;margin-top:10px;" onclick="window.print()">Print</button>
      </div>
    </div>
  `;
  document.getElementById("backdrop").addEventListener("click", (e) => { if (e.target.id === "backdrop") modalRoot.innerHTML = ""; });
  document.getElementById("modalCloseBtn").addEventListener("click", () => { modalRoot.innerHTML = ""; });
}

/* ---------------- Stay Information ---------------- */

async function renderStay() {
  const rows = await safeFetch("/api/residents/me/stay-history") || [];
  content.innerHTML = `
    <div class="table-card">
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Branch</th><th>Room</th><th>Bed</th><th>From</th><th>To</th><th>Rent</th><th>Reason</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((s) => `
              <tr>
                <td>${esc(s.branchName)}</td>
                <td>${esc(s.roomNumber)} (${esc(s.roomType)})</td>
                <td>${s.bedNumber}</td>
                <td>${fmtDate(s.startDate)}</td>
                <td>${s.endDate ? fmtDate(s.endDate) : "Current"}</td>
                <td>${currency(s.rentAtAssignment)}</td>
                <td>${esc(s.reason.replace("_", " "))}${s.notes ? " — " + esc(s.notes) : ""}</td>
              </tr>`).join("") : `<tr><td colspan="7" style="text-align:center;color:#8b8579;padding:32px;">No stay history yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------------- Notices ---------------- */

async function renderNotices() {
  const rows = await safeFetch("/api/notices/me") || [];
  content.innerHTML = rows.length ? rows.map((n) => `
    <div class="card" style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <h3 style="margin:0;">${esc(n.title)}</h3>
        <span style="font-size:12px;color:#8b8579;">${fmtDate(n.created_at)}</span>
      </div>
      <p style="margin:10px 0 0;color:#3a382f;">${esc(n.message)}</p>
    </div>
  `).join("") : `<div class="empty-state">No notices right now.</div>`;
}
