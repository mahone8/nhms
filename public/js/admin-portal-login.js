fetch("/api/auth/me").then((r) => r.json()).then(({ user }) => {
  if (user?.role === "admin" || user?.role === "super_admin") window.location.href = "/admin-portal/app.html";
});

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorMsg = document.getElementById("errorMsg");
  errorMsg.style.display = "none";
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorMsg.textContent = data.error || "Sign in failed.";
      errorMsg.style.display = "block";
      return;
    }
    if (data.user.role !== "admin" && data.user.role !== "super_admin") {
      errorMsg.textContent = "This portal is for Admin and Super Admin accounts only.";
      errorMsg.style.display = "block";
      await fetch("/api/auth/logout", { method: "POST" });
      return;
    }
    window.location.href = "/admin-portal/app.html";
  } catch (err) {
    errorMsg.textContent = "Could not reach the server. Please try again.";
    errorMsg.style.display = "block";
  }
});
