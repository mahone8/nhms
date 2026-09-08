let role = "admin";

const roleAdminBtn = document.getElementById("roleAdminBtn");
const roleResidentBtn = document.getElementById("roleResidentBtn");
const errorMsg = document.getElementById("errorMsg");

roleAdminBtn.addEventListener("click", () => setRole("admin"));
roleResidentBtn.addEventListener("click", () => setRole("resident"));

function setRole(r) {
  role = r;
  roleAdminBtn.classList.toggle("active", r === "admin");
  roleResidentBtn.classList.toggle("active", r === "resident");
  errorMsg.style.display = "none";
}

// If already signed in, jump straight to the right dashboard
fetch("/api/auth/me").then((r) => r.json()).then(({ user }) => {
  if (user?.role === "admin") window.location.href = "/admin/";
  if (user?.role === "resident") window.location.href = "/resident/";
});

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMsg.style.display = "none";
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorMsg.textContent = data.error || "Sign in failed.";
      errorMsg.style.display = "block";
      return;
    }
    window.location.href = role === "admin" ? "/admin/" : "/resident/";
  } catch (err) {
    errorMsg.textContent = "Could not reach the server. Please try again.";
    errorMsg.style.display = "block";
  }
});
