let currentUser = null;
const content = document.getElementById("content");

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
function fmtDateTime(d) { return d ? new Date(d).toLocaleString("en-US") : "—"; }

(async function init() {
  let me;
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) {
      content.innerHTML = `<div class="empty-state">Having trouble reaching the server. <button class="btn-outline" onclick="location.reload()">Retry</button></div>`;
      return;
    }
    me = await res.json();
  } catch (err) {
    content.innerHTML = `<div class="empty-state">Could not reach the server. <button class="btn-outline" onclick="location.reload()">Retry</button></div>`;
    return;
  }
  if (!me.user || (me.user.role !== "admin" && me.user.role !== "super_admin")) {
    window.location.href = "/admin-portal/";
    return;
  }
  currentUser = me.user;
  document.getElementById("welcomeMsg").textContent = `Welcome, ${me.user.username} (${me.user.role.replace("_", " ")})`;

  // Frontend hiding is a convenience, not the security boundary -- every
  // route behind these nav items still enforces its own role check
  // server-side (e.g. GET /api/audit-logs is Super Admin only regardless
  // of what this page shows or hides). This just avoids showing an Admin
  // a section that would only ever 403 for them.
  let anyVisible = false;
  let firstVisibleBtn = null;
  document.querySelectorAll(".nav-btn[data-tab]").forEach((btn) => {
    const requiredRole = btn.dataset.role;
    if (requiredRole && requiredRole !== currentUser.role) {
      btn.style.display = "none";
    } else {
      anyVisible = true;
      if (!firstVisibleBtn) firstVisibleBtn = btn;
      btn.addEventListener("click", () => switchTab(btn.dataset.tab, btn.textContent));
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/admin-portal/";
  });

  if (!anyVisible) {
    document.getElementById("pageTitle").textContent = "Admin Portal";
    content.innerHTML = `<div class="empty-state">No sections are available for your role yet.</div>`;
    return;
  }

  switchTab(firstVisibleBtn.dataset.tab, firstVisibleBtn.textContent);
})();

function switchTab(tab, title) {
  document.querySelectorAll(".nav-btn[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("pageTitle").textContent = title;
  if (tab === "audit-logs") renderAuditLogs();
  if (tab === "settings") renderSettings();
}

/* ---------------- System Settings ---------------- */

async function renderSettings() {
  const settings = await fetch("/api/settings").then((r) => r.json());
  const hostelName = settings.hostel_name || "";
  content.innerHTML = `
    <div class="card" style="max-width:480px;">
      <div class="field2"><label>Hostel name</label><input id="hostelName" value="${esc(hostelName)}" /></div>
      <button class="btn-dark" id="saveHostelName">Save</button>
      <div id="saveMsg" style="margin-top:10px;font-size:13px;"></div>
    </div>
  `;
  document.getElementById("saveHostelName").addEventListener("click", async () => {
    const value = document.getElementById("hostelName").value.trim();
    const res = await fetch("/api/settings/hostel_name", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    document.getElementById("saveMsg").textContent = res.ok ? "Saved." : "Failed to save.";
  });
}

/* ---------------- Audit Logs ---------------- */

let auditFilters = { limit: 100 };

async function renderAuditLogs() {
  content.innerHTML = `
    <div class="table-toolbar" style="margin-bottom:14px;background:#fff;border:1px solid #e4e0d8;border-radius:12px;">
      <span style="font-size:13px;color:#8b8579;">Showing the most recent entries. This log is append-only -- nothing here can be edited or deleted, including by a Super Admin.</span>
      <select id="limitSelect">
        <option value="50">Last 50</option>
        <option value="100" selected>Last 100</option>
        <option value="500">Last 500</option>
      </select>
    </div>
    <div class="table-card">
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Entity</th><th>Changes</th><th>IP</th></tr></thead>
          <tbody id="auditRows"></tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById("limitSelect").addEventListener("change", (e) => {
    auditFilters.limit = e.target.value;
    loadAuditLogs();
  });
  loadAuditLogs();
}

async function loadAuditLogs() {
  const res = await fetch(`/api/audit-logs?limit=${auditFilters.limit}`);
  const tbody = document.getElementById("auditRows");
  if (!res.ok) {
    // Only reachable if an Admin somehow lands here (nav item hidden for
    // them) or a session expires mid-view -- the API itself, not this
    // page, is what actually prevents Admin from seeing this data.
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#8b8579;padding:32px;">You do not have permission to view audit logs.</td></tr>`;
    return;
  }
  const rows = await res.json();
  tbody.innerHTML = rows.length ? rows.map((r) => `
    <tr>
      <td style="white-space:nowrap;">${fmtDateTime(r.created_at)}</td>
      <td>${esc(r.acting_username) || "—"}</td>
      <td>${esc(r.role) || "—"}</td>
      <td>${esc(r.action)}</td>
      <td>${esc(r.entity_type)}${r.entity_id ? " #" + r.entity_id : ""}</td>
      <td>${formatChanges(r)}</td>
      <td style="font-size:12px;color:#8b8579;">${esc(r.ip_address) || "—"}</td>
    </tr>
  `).join("") : `<tr><td colspan="7" style="text-align:center;color:#8b8579;padding:32px;">No audit log entries yet.</td></tr>`;
}

function formatChanges(r) {
  const parts = [];
  if (r.old_values) parts.push(`<div><b>Before:</b> <code style="font-size:11px;">${esc(JSON.stringify(r.old_values))}</code></div>`);
  if (r.new_values) parts.push(`<div><b>After:</b> <code style="font-size:11px;">${esc(JSON.stringify(r.new_values))}</code></div>`);
  if (r.metadata) parts.push(`<div><b>Details:</b> <code style="font-size:11px;">${esc(JSON.stringify(r.metadata))}</code></div>`);
  return parts.length ? parts.join("") : "—";
}
