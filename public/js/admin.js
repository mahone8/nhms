const TAB_TITLES = {
  overview: "Overview",
  branches: "Branches & beds",
  residents: "Residents",
  payments: "Payments",
  menu: "Menu",
  accounts: "Accounts",
};
const BRANCHES = ["Nazzal", "Nooroxotel", "Ayesha", "Aqsa", "Velvet Rose"];

let currentTab = "overview";
let branchTab = BRANCHES[0];
const content = document.getElementById("content");
const modalRoot = document.getElementById("modalRoot");

/* ---------------- Bootstrap / auth guard ---------------- */

(async function init() {
  const me = await fetch("/api/auth/me").then((r) => r.json());
  if (!me.user || me.user.role !== "admin") {
    window.location.href = "/";
    return;
  }
  document.querySelectorAll(".nav-btn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  });
  render();
})();

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".nav-btn[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("pageTitle").textContent = TAB_TITLES[tab];
  render();
}

function closeModal() { modalRoot.innerHTML = ""; }

function currency(n) { return "Rs. " + Number(n).toLocaleString("en-PK"); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }

async function render() {
  if (currentTab === "overview") return renderOverview();
  if (currentTab === "branches") return renderBranches();
  if (currentTab === "residents") return renderResidents();
  if (currentTab === "payments") return renderPayments();
  if (currentTab === "menu") return renderMenu();
  if (currentTab === "accounts") return renderAccounts();
}

/* ---------------- Overview ---------------- */

async function renderOverview() {
  content.innerHTML = `<p style="color:#8b8579;">Loading…</p>`;
  const branches = await fetch("/api/branches").then((r) => r.json());
  const payments = await fetch("/api/payments").then((r) => r.json());

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentPayments = payments.filter((p) => p.monthKey === monthKey);
  const collected = currentPayments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const pending = currentPayments.filter((p) => p.status !== "paid").reduce((s, p) => s + p.amount, 0);
  const overdueCount = currentPayments.filter((p) => p.status === "overdue").length;
  const totalBeds = branches.reduce((s, b) => s + b.totalBeds, 0);
  const occupied = branches.reduce((s, b) => s + b.occupiedBeds, 0);

  content.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="value">${totalBeds}</div><div class="label">Total beds</div></div>
      <div class="stat-card"><div class="value">${occupied}</div><div class="label">Occupied</div></div>
      <div class="stat-card"><div class="value">${currency(collected)}</div><div class="label">Collected this month</div></div>
      <div class="stat-card"><div class="value">${currency(pending)}</div><div class="label">Outstanding this month</div></div>
    </div>
    <div class="card" style="margin-bottom:18px;">
      <h3 style="margin-top:0;">Occupancy by branch</h3>
      ${branches.map((b) => {
        const pct = Math.round((b.occupiedBeds / b.totalBeds) * 100);
        return `<div class="progress-row">
          <div class="top"><span>${esc(b.name)}</span><span style="color:#8b8579;">${b.occupiedBeds}/${b.totalBeds} beds</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
        </div>`;
      }).join("")}
    </div>
    ${overdueCount > 0 ? `<div class="card" style="background:#fbecea;border-color:#f0d0cb;color:#b3453a;font-size:14px;">
      ${overdueCount} resident${overdueCount > 1 ? "s are" : " is"} overdue on this month's payment.
    </div>` : ""}
  `;
}

/* ---------------- Branches & beds ---------------- */

async function renderBranches() {
  content.innerHTML = `
    <div class="tabs-row" id="branchTabs"></div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="margin:0;" id="branchHeading"></h3>
        <span id="branchCount" style="font-size:12px;color:#8b8579;"></span>
      </div>
      <div class="bed-grid" id="bedGrid"></div>
    </div>
  `;
  document.getElementById("branchTabs").innerHTML = BRANCHES.map(
    (b) => `<button class="tab-chip ${b === branchTab ? "active" : ""}" data-branch="${esc(b)}">${esc(b)}</button>`
  ).join("");
  document.querySelectorAll("#branchTabs .tab-chip").forEach((chip) => {
    chip.addEventListener("click", () => { branchTab = chip.dataset.branch; renderBranches(); });
  });
  await loadBedGrid();
}

async function loadBedGrid() {
  const branches = await fetch("/api/branches").then((r) => r.json());
  const branch = branches.find((b) => b.name === branchTab);
  const beds = await fetch(`/api/branches/${branch.id}/beds`).then((r) => r.json());

  document.getElementById("branchHeading").textContent = `${branchTab} — bed layout`;
  document.getElementById("branchCount").textContent = `${beds.filter((b) => b.resident).length}/${beds.length} occupied`;
  document.getElementById("bedGrid").innerHTML = beds.map((bed) => `
    <button class="bed-cell ${bed.resident ? "occupied" : "vacant"}" data-bed-id="${bed.id}" data-bed-number="${bed.bedNumber}">
      <div>&#128719;</div>
      <div class="bed-num">Bed ${bed.bedNumber}</div>
      ${bed.resident ? `<div class="bed-name">${esc(bed.resident.name.split(" ")[0])}</div>` : ""}
    </button>
  `).join("");

  document.querySelectorAll("#bedGrid .bed-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      const bed = beds.find((b) => b.id === Number(cell.dataset.bedId));
      openBedModal(bed);
    });
  });
}

function openBedModal(bed) {
  const resident = bed.resident;
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="backdrop">
      <div class="modal-box">
        <button class="modal-close" id="modalCloseBtn">&times;</button>
        <h3>${esc(branchTab)} — Bed ${bed.bedNumber}</h3>
        <div id="modalBody"></div>
      </div>
    </div>
  `;
  document.getElementById("backdrop").addEventListener("click", (e) => { if (e.target.id === "backdrop") closeModal(); });
  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);

  const body = document.getElementById("modalBody");
  if (resident) {
    body.innerHTML = `
      <div class="card" style="background:#f7f5f1;border:none;margin-bottom:14px;">
        <div class="detail-row">&#128100; <b>${esc(resident.name)}</b></div>
        <div class="detail-row">&#128222; ${esc(resident.phone)}</div>
        <div class="detail-row">&#128197; Joined ${esc(resident.joinDate)}</div>
        <div class="detail-row">&#128176; ${currency(resident.monthlyFee)}/mo</div>
      </div>
      <button class="btn-outline" id="vacateBtn" style="width:100%;color:#b3453a;border-color:#f0d0cb;background:#fbecea;">Vacate bed / remove resident</button>
    `;
    document.getElementById("vacateBtn").addEventListener("click", async () => {
      await fetch(`/api/branches/beds/${bed.id}/vacate`, { method: "POST" });
      closeModal();
      loadBedGrid();
    });
  } else {
    body.innerHTML = `
      <p style="font-size:13px;color:#8b8579;margin-top:0;">This bed is vacant. Allocate a new resident:</p>
      <form id="allocForm">
        <div class="field2"><label>Full name</label><input id="rName" required /></div>
        <div class="field2"><label>Phone number</label><input id="rPhone" required placeholder="03XX-XXXXXXX" /></div>
        <div class="field2"><label>Monthly fee (Rs.)</label><input id="rFee" type="number" value="28000" /></div>
        <button type="submit" class="btn-dark" style="width:100%;">+ Allocate bed</button>
      </form>
    `;
    document.getElementById("allocForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("rName").value.trim();
      const phone = document.getElementById("rPhone").value.trim();
      const monthlyFee = Number(document.getElementById("rFee").value) || 28000;
      if (!name || !phone) return;
      await fetch(`/api/branches/beds/${bed.id}/allocate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, monthlyFee }),
      });
      closeModal();
      loadBedGrid();
    });
  }
}

/* ---------------- Residents ---------------- */

let residentFilters = { branch: "All", q: "" };

async function renderResidents() {
  content.innerHTML = `
    <div class="table-card">
      <div class="table-toolbar">
        <input id="residentSearch" placeholder="Search residents..." style="flex:1;min-width:180px;border:1px solid #e4e0d8;border-radius:8px;padding:8px 10px;font-size:13px;" />
        <select id="residentBranchFilter">
          <option>All</option>
          ${BRANCHES.map((b) => `<option>${esc(b)}</option>`).join("")}
        </select>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Name</th><th>Branch</th><th>Bed</th><th>Phone</th><th>Joined</th><th>Monthly fee</th></tr></thead>
          <tbody id="residentRows"></tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById("residentSearch").value = residentFilters.q;
  document.getElementById("residentBranchFilter").value = residentFilters.branch;
  document.getElementById("residentSearch").addEventListener("input", (e) => { residentFilters.q = e.target.value; loadResidents(); });
  document.getElementById("residentBranchFilter").addEventListener("change", (e) => { residentFilters.branch = e.target.value; loadResidents(); });
  await loadResidents();
}

async function loadResidents() {
  const params = new URLSearchParams();
  if (residentFilters.branch !== "All") params.set("branch", residentFilters.branch);
  if (residentFilters.q) params.set("q", residentFilters.q);
  const rows = await fetch(`/api/residents?${params}`).then((r) => r.json());
  document.getElementById("residentRows").innerHTML = rows.length ? rows.map((r) => `
    <tr>
      <td>${esc(r.name)}</td><td>${esc(r.branch)}</td><td>Bed ${r.bedNumber}</td>
      <td>${esc(r.phone)}</td><td>${esc(r.joinDate)}</td><td>${currency(r.monthlyFee)}</td>
    </tr>
  `).join("") : `<tr><td colspan="6" style="text-align:center;color:#8b8579;padding:32px;">No residents match.</td></tr>`;
}

/* ---------------- Payments ---------------- */

let paymentFilters = { branch: "All", status: "All" };

async function renderPayments() {
  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
      <div class="filters">
        <select id="payBranchFilter"><option>All</option>${BRANCHES.map((b) => `<option>${esc(b)}</option>`).join("")}</select>
        <select id="payStatusFilter">
          <option value="All">All</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>
      <button class="btn-dark" id="addPaymentBtn">+ Record payment</button>
    </div>
    <div class="table-card">
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Resident</th><th>Branch</th><th>Month</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody id="paymentRows"></tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById("payBranchFilter").value = paymentFilters.branch;
  document.getElementById("payStatusFilter").value = paymentFilters.status;
  document.getElementById("payBranchFilter").addEventListener("change", (e) => { paymentFilters.branch = e.target.value; loadPayments(); });
  document.getElementById("payStatusFilter").addEventListener("change", (e) => { paymentFilters.status = e.target.value; loadPayments(); });
  document.getElementById("addPaymentBtn").addEventListener("click", openAddPaymentModal);
  await loadPayments();
}

async function loadPayments() {
  const params = new URLSearchParams();
  if (paymentFilters.branch !== "All") params.set("branch", paymentFilters.branch);
  if (paymentFilters.status !== "All") params.set("status", paymentFilters.status);
  const rows = await fetch(`/api/payments?${params}`).then((r) => r.json());
  document.getElementById("paymentRows").innerHTML = rows.length ? rows.map((p) => `
    <tr>
      <td>${esc(p.residentName)}</td><td>${esc(p.branch)}</td><td>${esc(p.monthLabel)}</td>
      <td>${currency(p.amount)}</td>
      <td><span class="pill ${p.status}">${p.status[0].toUpperCase() + p.status.slice(1)}</span></td>
      <td style="text-align:right;">${p.status !== "paid" ? `<button class="link-btn" data-id="${p.id}">&#10003; Mark paid</button>` : ""}</td>
    </tr>
  `).join("") : `<tr><td colspan="6" style="text-align:center;color:#8b8579;padding:32px;">No payment records match.</td></tr>`;

  document.querySelectorAll("#paymentRows .link-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/payments/${btn.dataset.id}/pay`, { method: "POST" });
      loadPayments();
    });
  });
}

async function openAddPaymentModal() {
  const residents = await fetch("/api/residents").then((r) => r.json());
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="backdrop">
      <div class="modal-box">
        <button class="modal-close" id="modalCloseBtn">&times;</button>
        <h3>Record a payment</h3>
        <form id="addPaymentForm">
          <div class="field2">
            <label>Resident</label>
            <select id="payResident" required>
              <option value="">Select resident</option>
              ${residents.map((r) => `<option value="${r.id}" data-fee="${r.monthlyFee}">${esc(r.name)} — ${esc(r.branch)}, Bed ${r.bedNumber}</option>`).join("")}
            </select>
          </div>
          <div class="field2"><label>Month label</label><input id="payMonth" placeholder="e.g. October 2026" required /></div>
          <div class="field2"><label>Amount (Rs.)</label><input id="payAmount" type="number" /></div>
          <button type="submit" class="btn-dark" style="width:100%;">Add pending payment</button>
        </form>
      </div>
    </div>
  `;
  document.getElementById("backdrop").addEventListener("click", (e) => { if (e.target.id === "backdrop") closeModal(); });
  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
  document.getElementById("payResident").addEventListener("change", (e) => {
    const fee = e.target.selectedOptions[0]?.dataset.fee;
    if (fee) document.getElementById("payAmount").value = fee;
  });
  document.getElementById("addPaymentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const residentId = Number(document.getElementById("payResident").value);
    const monthLabel = document.getElementById("payMonth").value.trim();
    const amount = Number(document.getElementById("payAmount").value);
    if (!residentId || !monthLabel) return;
    await fetch("/api/payments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId, monthLabel, amount }),
    });
    closeModal();
    loadPayments();
  });
}

/* ---------------- Menu ---------------- */

async function renderMenu() {
  const menu = await fetch("/api/menu").then((r) => r.json());
  content.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
        <div>
          <h3 style="margin:0;">Shared menu</h3>
          <p style="font-size:12px;color:#8b8579;margin:4px 0 0;">This menu is shown to residents across all five branches.</p>
        </div>
        <div>
          <input type="file" id="menuFile" accept="image/png,image/jpeg" style="display:none;" />
          <button class="btn-dark" id="menuUploadBtn">${menu.filePath ? "Replace menu" : "Upload menu"}</button>
        </div>
      </div>
      <div id="menuError" style="display:none;color:#b3453a;font-size:13px;margin-bottom:10px;"></div>
      <div id="menuBody">
        ${menu.filePath
          ? `<img class="menu-img" src="${menu.filePath}" alt="Hostel menu" />
             <p class="upload-note">${esc(menu.fileName)} · uploaded ${new Date(menu.uploadedAt).toLocaleString()}</p>`
          : `<div class="empty-state">No menu uploaded yet.</div>`}
      </div>
    </div>
  `;
  document.getElementById("menuUploadBtn").addEventListener("click", () => document.getElementById("menuFile").click());
  document.getElementById("menuFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const errBox = document.getElementById("menuError");
    errBox.style.display = "none";
    const formData = new FormData();
    formData.append("menuImage", file);
    const res = await fetch("/api/menu", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) {
      errBox.textContent = data.error || "Upload failed.";
      errBox.style.display = "block";
      return;
    }
    renderMenu();
  });
}

/* ---------------- Accounts ---------------- */

async function renderAccounts() {
  const [{ admins, residents: resAccounts }, residents] = await Promise.all([
    fetch("/api/accounts").then((r) => r.json()),
    fetch("/api/residents").then((r) => r.json()),
  ]);
  const linkedIds = new Set(resAccounts.map((a) => a.residentId));
  const unlinked = residents.filter((r) => !linkedIds.has(r.id));

  content.innerHTML = `
    <div class="two-col">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="margin:0;">Admin accounts</h3>
          <button class="link-btn" id="addAdminBtn" style="color:#12161f;">+ Add</button>
        </div>
        <div id="adminList">
          ${admins.map((a) => `<div style="display:flex;justify-content:space-between;background:#f7f5f1;border-radius:8px;padding:8px 12px;margin-bottom:6px;font-size:14px;">
            <span>${esc(a.name)}</span><span style="color:#8b8579;font-size:12px;">@${esc(a.username)}</span>
          </div>`).join("")}
        </div>
        <div id="addAdminForm"></div>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="margin:0;">Resident accounts</h3>
          <button class="link-btn" id="addResAcctBtn" style="color:#12161f;">+ Add</button>
        </div>
        <div id="resAcctList" style="max-height:220px;overflow-y:auto;">
          ${resAccounts.map((a) => `<div style="display:flex;justify-content:space-between;background:#f7f5f1;border-radius:8px;padding:8px 12px;margin-bottom:6px;font-size:14px;">
            <span>${esc(a.residentName)}</span><span style="color:#8b8579;font-size:12px;">@${esc(a.username)}</span>
          </div>`).join("")}
        </div>
        <div id="addResAcctForm"></div>
      </div>
    </div>
  `;

  document.getElementById("addAdminBtn").addEventListener("click", () => {
    document.getElementById("addAdminForm").innerHTML = `
      <form id="adminForm" style="margin-top:14px;border-top:1px solid #e4e0d8;padding-top:14px;">
        <div class="field2"><input id="aName" placeholder="Full name" required /></div>
        <div class="field2"><input id="aUsername" placeholder="Username" required /></div>
        <div class="field2"><input id="aPassword" placeholder="Password" required /></div>
        <button type="submit" class="btn-dark" style="width:100%;">Create admin account</button>
      </form>
    `;
    document.getElementById("adminForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("aName").value.trim();
      const username = document.getElementById("aUsername").value.trim();
      const password = document.getElementById("aPassword").value;
      if (!name || !username || !password) return;
      const res = await fetch("/api/accounts/admin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, password }),
      });
      if (res.ok) renderAccounts();
    });
  });

  document.getElementById("addResAcctBtn").addEventListener("click", () => {
    document.getElementById("addResAcctForm").innerHTML = `
      <form id="resAcctForm" style="margin-top:14px;border-top:1px solid #e4e0d8;padding-top:14px;">
        <div class="field2">
          <select id="raResident" required>
            <option value="">Select resident</option>
            ${unlinked.map((r) => `<option value="${r.id}">${esc(r.name)} — ${esc(r.branch)}</option>`).join("")}
          </select>
        </div>
        <div class="field2"><input id="raUsername" placeholder="Username" required /></div>
        <div class="field2"><input id="raPassword" placeholder="Password" required /></div>
        <button type="submit" class="btn-dark" style="width:100%;">Create resident login</button>
      </form>
    `;
    document.getElementById("resAcctForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const residentId = Number(document.getElementById("raResident").value);
      const username = document.getElementById("raUsername").value.trim();
      const password = document.getElementById("raPassword").value;
      if (!residentId || !username || !password) return;
      const res = await fetch("/api/accounts/resident", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId, username, password }),
      });
      if (res.ok) renderAccounts();
    });
  });
}
