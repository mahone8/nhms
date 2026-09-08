let currentTab = "overview";
const content = document.getElementById("content");

function currency(n) { return "Rs. " + Number(n).toLocaleString("en-PK"); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }

(async function init() {
  const me = await fetch("/api/auth/me").then((r) => r.json());
  if (!me.user || me.user.role !== "resident") {
    window.location.href = "/";
    return;
  }
  document.getElementById("welcomeMsg").textContent = `Welcome, ${me.user.username}`;
  document.querySelectorAll(".top-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTab = btn.dataset.tab;
      document.querySelectorAll(".top-tab").forEach((b) => b.classList.toggle("active", b === btn));
      render();
    });
  });
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  });
  render();
})();

async function render() {
  if (currentTab === "overview") return renderOverview();
  if (currentTab === "payments") return renderPayments();
  if (currentTab === "menu") return renderMenu();
}

async function renderOverview() {
  const res = await fetch("/api/residents/me");
  if (!res.ok) {
    content.innerHTML = `<div class="empty-state">This resident record no longer exists.</div>`;
    return;
  }
  const r = await res.json();
  content.innerHTML = `
    <div class="card" style="max-width:420px;">
      <h3 style="margin-top:0;">${esc(r.branch)}</h3>
      <div class="detail-row">&#128719; Bed ${r.bedNumber}</div>
      <div class="detail-row">&#128222; ${esc(r.phone)}</div>
      <div class="detail-row">&#128197; Joined ${esc(r.joinDate)}</div>
      <div class="detail-row">&#128176; ${currency(r.monthlyFee)}/month</div>
    </div>
  `;
}

async function renderPayments() {
  const rows = await fetch("/api/payments/me").then((r) => r.json());
  content.innerHTML = `
    <div class="table-card">
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Month</th><th>Amount</th><th>Status</th><th>Paid on</th></tr></thead>
          <tbody>
            ${rows.map((p) => `
              <tr>
                <td>${esc(p.monthLabel)}</td>
                <td>${currency(p.amount)}</td>
                <td><span class="pill ${p.status}">${p.status[0].toUpperCase() + p.status.slice(1)}</span></td>
                <td>${p.paidDate || "—"}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderMenu() {
  const menu = await fetch("/api/menu").then((r) => r.json());
  content.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">Menu</h3>
      ${menu.filePath
        ? `<img class="menu-img" src="${menu.filePath}" alt="Hostel menu" />
           <p class="upload-note">Updated ${new Date(menu.uploadedAt).toLocaleString()}</p>`
        : `<div class="empty-state">No menu has been uploaded yet.</div>`}
    </div>
  `;
}
